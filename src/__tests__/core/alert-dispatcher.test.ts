// failure paths that don't need a real db. the happy path is covered by the
// dispatcher-email test plus a manual smoke test (scripts/test-outbox.ts),
// which the e2e script runs in CI.

// wrap `eq` so the fake db can recover the id without depending on drizzle's
// internal AST shape. module-level mock, scoped to this file.
jest.mock('drizzle-orm', () => {
  const actual = jest.requireActual('drizzle-orm');
  return {
    ...actual,
    eq: (col: unknown, value: unknown) => {
      const real = actual.eq(col, value);
      (real as unknown as { _id: unknown })._id = value;
      return real;
    },
  };
});

import { AlertDispatcherWorker } from '../../core/alert-dispatcher';
import { Dispatcher } from '../../notifications/dispatcher';
import { schema } from '../../db';

function makePending(overrides: Partial<schema.PendingAlert> = {}): schema.PendingAlert {
  return {
    id: 1,
    meterId: 7,
    userId: 1,
    action: 'low-alert',
    level: 'low',
    payload: JSON.stringify({
      nickname: null,
      accountNo: '12345678',
      meterNo: '87654321',
      balance: 42.5,
      lowThreshold: 150,
      criticalThreshold: 100,
      prediction: null,
    }),
    createdAt: new Date(),
    attempts: 0,
    nextAttempt: new Date(Date.now() - 1000),
    status: 'pending',
    lastError: null,
    deliveredAt: null,
    delivered: '[]',
    ...overrides,
  };
}

function makeFakeDb(opts: {
  pendingRows: schema.PendingAlert[];
  user?: schema.User;
  meter?: schema.Meter;
  /** counts SELECTs per table, so a test can pin how many the worker issues */
  selects?: Map<unknown, number>;
}) {
  const db = {
    select() {
      return {
        from(table: unknown) {
          opts.selects?.set(table, (opts.selects.get(table) ?? 0) + 1);
          return {
            where(_p: unknown) {
              return {
                orderBy() {
                  return {
                    limit() {
                      const rows = table === schema.pendingAlerts ? opts.pendingRows : [];
                      return {
                        for() {
                          return Promise.resolve(rows);
                        },
                      };
                    },
                  };
                },
                async then(resolve: (rows: unknown[]) => void) {
                  if (table === schema.users) {
                    resolve(opts.user ? [opts.user] : []);
                  } else if (table === schema.meters) {
                    resolve(opts.meter ? [opts.meter] : []);
                  } else {
                    resolve([]);
                  }
                },
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Partial<schema.PendingAlert>) {
          return {
            where(predicate: unknown) {
              const id = extractId(predicate);
              const row = opts.pendingRows.find(p => p.id === id);
              if (row && table === schema.pendingAlerts) {
                Object.assign(row, values);
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
    // the worker claims its batch inside a transaction (select FOR UPDATE +
    // lease update); the fake just runs the callback against itself.
    transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };
  return db;
}

function extractId(predicate: unknown): number {
  if (typeof predicate === 'object' && predicate !== null && '_id' in predicate) {
    return (predicate as { _id: number })._id;
  }
  return 0;
}

function aUser(): schema.User {
  return {
    id: 1,
    telegramChatId: 123,
    plan: 'free',
    tonePref: 'savage',
    quietStart: null,
    quietEnd: null,
  } as unknown as schema.User;
}

function aMeter(): schema.Meter {
  return { id: 7, accountNo: '12345678', meterNo: '87654321' } as unknown as schema.Meter;
}

function workerWith(
  db: ReturnType<typeof makeFakeDb>,
  dispatchAlert: jest.Mock,
  extra: { adminSender?: { sendTelegram: jest.Mock }; adminChatId?: number } = {}
) {
  return new AlertDispatcherWorker({
    db: db as never,
    dispatcher: { dispatchAlert } as unknown as Dispatcher,
    ...extra,
  });
}

describe('AlertDispatcherWorker failure paths', () => {
  it('marks a row with malformed payload as failed without infinite retry', async () => {
    const row = makePending({ id: 11, payload: 'not-json' });
    const db = makeFakeDb({
      pendingRows: [row],
      user: { id: 1, telegramChatId: null, plan: 'free' } as unknown as schema.User,
      meter: { id: 7 } as unknown as schema.Meter,
    });
    const dispatcher = new Dispatcher(db as never, { sendTelegram: jest.fn() }, null, null);
    const worker = new AlertDispatcherWorker({ db: db as never, dispatcher });
    await worker.tick();
    expect(row.status).toBe('failed');
    expect(row.lastError).toMatch(/invalid payload/);
  });

  it('marks a row pointing at a deleted user as failed', async () => {
    const row = makePending({ id: 9, userId: 999 });
    const db = makeFakeDb({
      pendingRows: [row],
      meter: { id: 7 } as unknown as schema.Meter,
    });
    const dispatcher = new Dispatcher(db as never, { sendTelegram: jest.fn() }, null, null);
    const worker = new AlertDispatcherWorker({ db: db as never, dispatcher });
    await worker.tick();
    expect(row.status).toBe('failed');
    expect(row.lastError).toMatch(/user or meter deleted/);
  });
});

describe('AlertDispatcherWorker retry semantics', () => {
  it('marks the row sent and records the delivered channels', async () => {
    const row = makePending({ id: 21 });
    const db = makeFakeDb({ pendingRows: [row], user: aUser(), meter: aMeter() });
    const dispatchAlert = jest.fn().mockResolvedValue({ delivered: ['telegram'], failed: [] });
    await workerWith(db, dispatchAlert).tick();

    expect(row.status).toBe('sent');
    expect(row.deliveredAt).toBeInstanceOf(Date);
    expect(JSON.parse(row.delivered)).toEqual(['telegram']);
    expect(row.lastError).toBeNull();
  });

  it('retries only the failed channel and skips the already-delivered one', async () => {
    const row = makePending({ id: 22 });
    const db = makeFakeDb({ pendingRows: [row], user: aUser(), meter: aMeter() });
    const dispatchAlert = jest
      .fn()
      .mockResolvedValueOnce({ delivered: ['telegram'], failed: ['email:9'] })
      .mockResolvedValueOnce({ delivered: ['email:9'], failed: [] });
    const worker = workerWith(db, dispatchAlert);

    await worker.tick();
    // first pass: telegram landed, email failed -> stay pending and back off
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(JSON.parse(row.delivered)).toEqual(['telegram']);
    expect(row.lastError).toMatch(/email:9/);
    expect(row.nextAttempt.getTime()).toBeGreaterThan(Date.now());

    await worker.tick();
    // second pass: worker passed the delivered set so telegram isn't resent
    const deliveredArg = dispatchAlert.mock.calls[1][5] as Set<string>;
    expect(deliveredArg.has('telegram')).toBe(true);
    expect(row.status).toBe('sent');
    expect(new Set(JSON.parse(row.delivered))).toEqual(new Set(['telegram', 'email:9']));
  });

  it('dead-letters after MAX_ATTEMPTS and pings the operator', async () => {
    const row = makePending({ id: 23, attempts: 4 });
    const db = makeFakeDb({ pendingRows: [row], user: aUser(), meter: aMeter() });
    const dispatchAlert = jest.fn().mockResolvedValue({ delivered: [], failed: ['telegram'] });
    const adminSender = { sendTelegram: jest.fn(async () => undefined) };
    await workerWith(db, dispatchAlert, { adminSender, adminChatId: 555 }).tick();

    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(5);
    expect(adminSender.sendTelegram).toHaveBeenCalledTimes(1);
  });

  it('retries the whole row when dispatchAlert throws unexpectedly', async () => {
    const row = makePending({ id: 24 });
    const db = makeFakeDb({ pendingRows: [row], user: aUser(), meter: aMeter() });
    const dispatchAlert = jest.fn().mockRejectedValue(new Error('boom'));
    await workerWith(db, dispatchAlert).tick();

    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/boom/);
  });
});

describe('AlertDispatcherWorker quiet hours', () => {
  const { dhakaHour } = require('../../core/quiet-hours');
  // a 1-hour window pinned to the current Dhaka hour, so "now" is always
  // inside it regardless of when the test runs
  const quietNowUser = () => {
    const h = dhakaHour(new Date());
    return { ...aUser(), quietStart: h, quietEnd: (h + 1) % 24 } as unknown as schema.User;
  };

  it('defers a non-critical alert instead of marking it sent', async () => {
    const row = makePending({ id: 31, action: 'low-alert' });
    const db = makeFakeDb({ pendingRows: [row], user: quietNowUser(), meter: aMeter() });
    const dispatchAlert = jest.fn();
    await workerWith(db, dispatchAlert).tick();

    expect(dispatchAlert).not.toHaveBeenCalled();
    expect(row.status).toBe('pending'); // deferred, NOT 'sent'
    expect(row.attempts).toBe(0); // a hold is not a failed attempt
    expect(row.nextAttempt.getTime()).toBeGreaterThan(Date.now());
    // resumes when the window ends, within the next day
    expect(row.nextAttempt.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
  });

  it('lets a critical alert through quiet hours untouched', async () => {
    const row = makePending({ id: 32, action: 'critical-alert', level: 'critical' });
    const db = makeFakeDb({ pendingRows: [row], user: quietNowUser(), meter: aMeter() });
    const dispatchAlert = jest.fn().mockResolvedValue({ delivered: ['telegram'], failed: [] });
    await workerWith(db, dispatchAlert).tick();

    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('sent');
  });

  it('fetches users and meters once per batch, not once per row', async () => {
    // The worker used to re-SELECT the user and the meter for every row it drained,
    // so a batch of N alerts cost 2N single-row queries. They are batched now, and
    // deliberately not joined into the claim - that SELECT is FOR UPDATE ... SKIP
    // LOCKED, and joining would take row locks on users/meters, which the bots write.
    const rows = [1, 2, 3].map(id => makePending({ id }));
    const selects = new Map<unknown, number>();
    const db = makeFakeDb({ pendingRows: rows, user: aUser(), meter: aMeter(), selects });
    const dispatchAlert = jest.fn().mockResolvedValue({ delivered: ['telegram'], failed: [] });

    await workerWith(db, dispatchAlert).tick();

    expect(dispatchAlert).toHaveBeenCalledTimes(3);
    expect(selects.get(schema.users)).toBe(1);
    expect(selects.get(schema.meters)).toBe(1);
  });

  it('does not wedge the worker when a row hangs', async () => {
    // The liveness bug hiding under the "claim lease is a bit long" note: tick()
    // returns early while a batch is in flight, so one row that never settles used
    // to stop the outbox draining *anything*, indefinitely. The row timeout means
    // the batch always finishes and the next tick runs.
    jest.useFakeTimers();
    try {
      const row = makePending({ id: 50 });
      const db = makeFakeDb({ pendingRows: [row], user: aUser(), meter: aMeter() });
      const dispatchAlert = jest.fn(() => new Promise<never>(() => {})); // never settles
      const worker = workerWith(db, dispatchAlert);

      const first = worker.tick();
      await jest.advanceTimersByTimeAsync(60_000);
      await first; // resolves rather than hanging forever

      // and the worker is free again - a second tick actually does work
      dispatchAlert.mockImplementation(
        () => Promise.resolve({ delivered: ['telegram'], failed: [] }) as never
      );
      await worker.tick();
      expect(dispatchAlert).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('dead-letters a row whose user was deleted mid-flight', async () => {
    const row = makePending({ id: 40 });
    const db = makeFakeDb({ pendingRows: [row], user: undefined, meter: aMeter() });
    const dispatchAlert = jest.fn();

    await workerWith(db, dispatchAlert).tick();

    expect(dispatchAlert).not.toHaveBeenCalled();
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('user or meter deleted');
  });
});

describe('logger PII masks', () => {
  const { maskEmail, maskPhone, maskAccount } = require('../../logger');

  it('masks email addresses', () => {
    expect(maskEmail('rijoanul.shanto@gmail.com')).toBe('ri***@gmail.com');
  });

  it('masks phone numbers preserving country code and last 3 digits', () => {
    // "+8801712345678" -> "+8801712" + "******" + "678" = "+8801712******678"
    // (13 digits total, mask the 6 in the middle, preserve the 7 leading + 3 trailing)
    expect(maskPhone('+8801712345678')).toBe('+8801712******678');
  });

  it('masks account numbers keeping first 2 and last 2', () => {
    expect(maskAccount('13151091')).toBe('13****91');
  });
});
