import { recordReading } from '../../core/meter-reading';
import { Db, schema } from '../../db';

// recordReading is the single path every balance read goes through (poll cycle,
// add-a-meter, force check, operator re-check). It exists because writing only
// the reading row is a silent failure: the dashboard reads right and the alert
// never fires.

interface Recorded {
  inserts: { table: unknown; values: unknown }[];
  upserts: { table: unknown; values: unknown }[];
  selects: unknown[];
}

function fakeDb(alertStateRows: unknown[] = []) {
  const rec: Recorded = { inserts: [], upserts: [], selects: [] };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          rec.selects.push(table);
          return table === schema.alertState ? alertStateRows : [];
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        const b = {
          onConflictDoUpdate: async () => {
            rec.upserts.push({ table, values });
          },
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            rec.inserts.push({ table, values });
            return Promise.resolve(undefined).then(res, rej);
          },
        };
        return b;
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as Db;
  return { db, rec };
}

const meter = (over: Partial<schema.Meter> = {}) =>
  ({
    id: 4,
    userId: 9,
    provider: 'desco',
    accountNo: '12345',
    meterNo: '67890',
    nickname: null,
    lowThreshold: 150,
    criticalThreshold: 100,
    active: true,
    ...over,
  }) as schema.Meter;

const opts = { reminderIntervalMs: 24 * 60 * 60 * 1000, rechargeUrl: 'https://example.test/' };

describe('recordReading', () => {
  it('stores the reading and queues an alert when the balance is critical', async () => {
    const { db, rec } = fakeDb();
    const result = await recordReading(db, meter(), 9, { balance: 42.5 }, opts);

    expect(result).toEqual({ level: 'critical', alertQueued: true });
    expect(rec.inserts.some(i => i.table === schema.readings)).toBe(true);
    expect(rec.inserts.some(i => i.table === schema.pendingAlerts)).toBe(true);
    expect(rec.upserts.some(u => u.table === schema.alertState)).toBe(true);
  });

  it('stores the reading and queues nothing when the balance is healthy', async () => {
    const { db, rec } = fakeDb();
    const result = await recordReading(db, meter(), 9, { balance: 900 }, opts);

    expect(result).toEqual({ level: 'ok', alertQueued: false });
    expect(rec.inserts.some(i => i.table === schema.readings)).toBe(true);
    expect(rec.inserts.some(i => i.table === schema.pendingAlerts)).toBe(false);
  });

  it('carries the consumption and reading time from the provider onto the row', async () => {
    const { db, rec } = fakeDb();
    await recordReading(
      db,
      meter(),
      9,
      { balance: 900, currentMonthConsumption: 123.45, readingTime: '2026-08-21 10:00:00' },
      opts
    );
    const row = rec.inserts.find(i => i.table === schema.readings)!.values as {
      currentMonthConsumption: number;
      readingTime: string;
    };
    expect(row.currentMonthConsumption).toBe(123.45);
    expect(row.readingTime).toBe('2026-08-21 10:00:00');
  });

  it('selects alert_state when no joined row is handed in', async () => {
    const { db, rec } = fakeDb();
    await recordReading(db, meter(), 9, { balance: 900 }, opts);
    expect(rec.selects).toContain(schema.alertState);
  });

  it('takes the poll cycle joined row without re-selecting a healthy meter', async () => {
    const { db, rec } = fakeDb();
    await recordReading(
      db,
      meter(),
      9,
      { balance: 900 },
      {
        ...opts,
        joinedState: { level: 'ok' } as never,
      }
    );
    // the join already carried it - an extra select per meter per cycle is what
    // the joinedState option exists to avoid
    expect(rec.selects).not.toContain(schema.alertState);
  });

  it('re-reads alert_state for a meter already in alert (snooze can move underneath us)', async () => {
    const { db, rec } = fakeDb([{ level: 'critical', remindersSnoozedUntil: null }]);
    await recordReading(
      db,
      meter(),
      9,
      { balance: 42.5 },
      {
        ...opts,
        joinedState: { level: 'critical' } as never,
      }
    );
    expect(rec.selects).toContain(schema.alertState);
  });
});
