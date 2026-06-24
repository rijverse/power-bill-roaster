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

describe('AlertDispatcherWorker failure paths', () => {
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
      ...overrides,
    };
  }

  function makeFakeDb(opts: {
    pendingRows: schema.PendingAlert[];
    user?: schema.User;
    meter?: schema.Meter;
  }) {
    const db = {
      select() {
        return {
          from(table: unknown) {
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
    };
    return db;
  }

  function extractId(predicate: unknown): number {
    if (typeof predicate === 'object' && predicate !== null && '_id' in predicate) {
      return (predicate as { _id: number })._id;
    }
    return 0;
  }

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
