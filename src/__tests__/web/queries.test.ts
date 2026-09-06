import { dashboardData } from '../../web/queries';
import { Db, schema } from '../../db';

// A paused meter keeps its history, thresholds, and nickname, so it has to stay
// in the payload: while it was filtered out entirely, a pause (the customer's
// own, or an operator's) looked exactly like an account with no meters, and
// there was nothing to resume.

type Row = Record<string, unknown>;

function fakeDb(meters: Row[], readings: Row[] = [], alerts: Row[] = []) {
  return {
    select: () => ({
      from: (t: unknown) => {
        const rows = t === schema.meters ? meters : t === schema.readings ? readings : alerts;
        const b = {
          where: () => b,
          orderBy: () => b,
          limit: () => Promise.resolve(rows),
          then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve(rows).then(res, rej),
        };
        return b;
      },
    }),
  } as unknown as Db;
}

const meter = (over: Row = {}): Row => ({
  id: 1,
  userId: 1,
  provider: 'desco',
  accountNo: '12345',
  meterNo: '67890',
  nickname: null,
  lowThreshold: 150,
  criticalThreshold: 100,
  active: true,
  ...over,
});

describe('dashboardData', () => {
  it('reports paused meters separately from active ones', async () => {
    const db = fakeDb([
      meter({ id: 1, active: true }),
      meter({ id: 2, meterNo: '11111', active: false }),
    ]);
    const data = await dashboardData(db, 1);

    expect(data.meters.map(m => m.id)).toEqual([1]);
    expect(data.pausedMeters).toEqual([
      { id: 2, label: 'Meter 11111', meterNo: '11111', accountNo: '12345' },
    ]);
  });

  it('still lists the paused ones when nothing is active', async () => {
    const db = fakeDb([meter({ id: 2, active: false })]);
    const data = await dashboardData(db, 1);

    expect(data.meters).toEqual([]);
    expect(data.pausedMeters).toHaveLength(1);
  });

  it('prefers the nickname as the paused label', async () => {
    const db = fakeDb([meter({ id: 3, active: false, nickname: 'Flat 3B' })]);
    const data = await dashboardData(db, 1);
    expect(data.pausedMeters[0].label).toBe('Flat 3B');
  });

  it('is empty on both counts for an account with no meters', async () => {
    const data = await dashboardData(fakeDb([]), 1);
    expect(data).toEqual({ meters: [], alerts: [], pausedMeters: [] });
  });
});
