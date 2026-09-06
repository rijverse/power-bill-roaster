import { Db, schema } from '../../db';
import { SubscriptionService } from '../../billing/subscriptions';
import { PaymentProvider } from '../../billing/types';

// jest.mock('./core/meter-cap') is set up per-test below via jest.mock at the
// top, overridden in beforeEach. We mock it so the transaction test can inject
// a throw inside the transaction body (where enforceMeterCap runs) and prove
// the preceding writes roll back.
jest.mock('../../core/meter-cap', () => ({
  enforceMeterCap: jest.fn(),
}));

const { enforceMeterCap } = require('../../core/meter-cap') as {
  enforceMeterCap: jest.Mock;
};

// A minimal in-memory db that models just the query chains expireOverdue and
// finalizePending use. Non-tx writes apply immediately; tx writes buffer and
// commit on resolve / discard on throw, so the atomicity test can prove a
// mid-tx failure rolls the writes back.
function makeDb(opts: {
  subscriptions: schema.Subscription[];
  users: schema.User[];
  meters?: schema.Meter[];
  payments?: schema.Payment[];
}) {
  const subs = opts.subscriptions.map(s => ({ ...s }));
  const users = opts.users.map(u => ({ ...u }));
  const meters = (opts.meters ?? []).map(m => ({ ...m }));
  const payments = (opts.payments ?? []).map(p => ({ ...p }));

  function findSub(where: (s: schema.Subscription) => boolean) {
    return subs.find(where);
  }

  function makeQueryer(committedStore: { apply: (writes: Write[]) => void }) {
    const db = {
      select() {
        const chain = {
          from(table: unknown) {
            return {
              where(pred: unknown) {
                // finalizePending selects by externalRef (a single eq with _id);
                // expireOverdue selects by and(eq(status), lt(end)) (no _id).
                if (table === schema.subscriptions) {
                  const id = extractEq(pred, 'external_ref');
                  if (id !== undefined) {
                    return Promise.resolve(subs.filter(s => s.externalRef === id));
                  }
                  return Promise.resolve(subs.filter(s => s.status === 'active'));
                }
                // users select by id
                if (table === schema.users) {
                  return Promise.resolve(users.filter(u => u.id === extractEq(pred, 'id')));
                }
                // meters select for meter cap
                if (table === schema.meters) {
                  return Promise.resolve(meters);
                }
                return Promise.resolve([]);
              },
            };
          },
        };
        return chain;
      },
      update(table: unknown) {
        return {
          set(values: Partial<schema.Subscription>) {
            return {
              where(pred: unknown) {
                const apply = () => committedStore.apply([{ table, values, pred }]);
                const thenable = {
                  then(resolve: (v: unknown) => void) {
                    apply();
                    resolve(undefined);
                    return thenable;
                  },
                  returning() {
                    apply();
                    return Promise.resolve(subs.filter(s => s.id === extractEq(pred, 'id')));
                  },
                };
                return thenable;
              },
            };
          },
        };
      },
      insert(_table: unknown) {
        return {
          values(_v: unknown) {
            return {
              returning() {
                return Promise.resolve([{ id: 1 }]);
              },
              onConflictDoNothing() {
                return { returning: () => Promise.resolve([{ id: 1 }]) };
              },
            };
          },
        };
      },
      async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
        const bufferedWrites: Write[] = [];
        const tx = {
          select: db.select,
          update(table: unknown) {
            return {
              set(values: Partial<schema.Subscription>) {
                return {
                  where(pred: unknown) {
                    const thenable = {
                      then(resolve: (v: unknown) => void) {
                        bufferedWrites.push({ table, values, pred });
                        resolve(undefined);
                        return thenable;
                      },
                    };
                    return thenable;
                  },
                };
              },
            };
          },
          insert: db.insert,
        };
        const result = await fn(tx);
        // commit: apply buffered writes to the committed store
        committedStore.apply(bufferedWrites);
        return result;
      },
    };
    return db;
  }

  interface Write {
    table: unknown;
    values: Partial<schema.Subscription>;
    pred: unknown;
  }

  function applyWrites(writes: Write[]) {
    for (const w of writes) {
      if (w.table === schema.subscriptions) {
        const s = subs.find(s => s.id === extractEq(w.pred, 'id'));
        if (s) Object.assign(s, w.values);
      } else if (w.table === schema.users) {
        const u = users.find(u => u.id === extractEq(w.pred, 'id'));
        if (u) Object.assign(u, w.values);
      } else if (w.table === schema.meters) {
        // meter cap pausing; not asserted in detail here
      }
    }
  }

  const committedStore = { apply: applyWrites };
  const db = makeQueryer(committedStore);

  return {
    db: db as unknown as Db,
    subs,
    users,
    payments,
    findSub,
  };
}

// extract a value from a mock eq() predicate. The real eq returns a drizzle
// AST; we can't introspect it here, so the fake db's where() for users/meters
// matches by reading the predicate's _id (set by the eq mock in alert-dispatcher
// tests). For subscriptions we just filter by status='active'.
function extractEq(pred: unknown, _field: string): unknown {
  if (typeof pred === 'object' && pred !== null && '_id' in pred) {
    return pred._id;
  }
  return undefined;
}

// eq mock so predicates carry the value for extractEq
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

function aProvider(): PaymentProvider {
  return {
    name: 'sandbox',
    autoConfirms: false,
    createCheckout: jest.fn(),
    verifyPayment: jest.fn(),
  };
}

function overdueSub(userId = 1): schema.Subscription {
  return {
    id: 10,
    userId,
    plan: 'plus',
    provider: 'sandbox',
    status: 'active',
    externalRef: 'ref-1',
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2026-02-01'), // long past grace
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function aUser(id = 1, plan = 'plus'): schema.User {
  return { id, plan, telegramChatId: 123 } as unknown as schema.User;
}

describe('SubscriptionService hooks (WS13)', () => {
  it('fires notifyDowngrade on expiry with the paused meter count', async () => {
    enforceMeterCap.mockResolvedValue(2);
    const { db, subs, users } = makeDb({
      subscriptions: [overdueSub(1)],
      users: [aUser(1, 'plus')],
    });
    const svc = new SubscriptionService(db, aProvider());
    const downgrade = jest.fn();
    const upgrade = jest.fn();
    svc.setHooks({ notifyDowngrade: downgrade, notifyUpgrade: upgrade });

    const count = await svc.expireOverdue();

    expect(count).toBe(1);
    expect(downgrade).toHaveBeenCalledTimes(1);
    expect(downgrade.mock.calls[0][1]).toBe('plus'); // expired plan
    expect(downgrade.mock.calls[0][2]).toBe(2); // paused meters
    expect(subs[0].status).toBe('expired');
    expect(users[0].plan).toBe('free');
  });

  it('skips the notice gracefully when no hook is wired (no silent crash)', async () => {
    enforceMeterCap.mockResolvedValue(0);
    const { db } = makeDb({
      subscriptions: [overdueSub(1)],
      users: [aUser(1, 'plus')],
    });
    const svc = new SubscriptionService(db, aProvider());
    // no setHooks call - hooks stay empty
    await expect(svc.expireOverdue()).resolves.toBe(1);
  });

  it('does not crash the expiry if the downgrade notice itself throws', async () => {
    enforceMeterCap.mockResolvedValue(0);
    const { db } = makeDb({
      subscriptions: [overdueSub(1)],
      users: [aUser(1, 'plus')],
    });
    const svc = new SubscriptionService(db, aProvider());
    const throwingDowgrade = jest.fn().mockRejectedValue(new Error('channel down'));
    svc.setHooks({ notifyDowngrade: throwingDowgrade });

    // the downgrade still completes; the notice failure is logged, not fatal
    await expect(svc.expireOverdue()).resolves.toBe(1);
    expect(throwingDowgrade).toHaveBeenCalled();
  });
});

describe('expireOverdue transaction atomicity (WS2)', () => {
  it('rolls back the subscription-status and user-plan writes when the meter cap throws', async () => {
    // A crash between marking the subscription expired and applying the meter
    // cap used to leave an expired subscription with a still-paid plan. Now the
    // three writes are in one tx, so a mid-tx failure rolls them all back.
    enforceMeterCap.mockRejectedValue(new Error('db gone'));
    const { db, subs, users } = makeDb({
      subscriptions: [overdueSub(1)],
      users: [aUser(1, 'plus')],
    });
    const svc = new SubscriptionService(db, aProvider());
    svc.setHooks({ notifyDowngrade: jest.fn() });

    await expect(svc.expireOverdue()).rejects.toThrow('db gone');
    // rolled back: subscription still active, user still on plus
    expect(subs[0].status).toBe('active');
    expect(users[0].plan).toBe('plus');
  });

  it('commits all three writes when the meter cap succeeds', async () => {
    enforceMeterCap.mockResolvedValue(1);
    const { db, subs, users } = makeDb({
      subscriptions: [overdueSub(1)],
      users: [aUser(1, 'plus')],
    });
    const svc = new SubscriptionService(db, aProvider());
    svc.setHooks({ notifyDowngrade: jest.fn() });

    await svc.expireOverdue();
    expect(subs[0].status).toBe('expired');
    expect(users[0].plan).toBe('free');
  });
});

describe('finalizePending notifyUpgrade hook', () => {
  it('notifies on the first confirmation and is idempotent on a duplicate', async () => {
    const provider = aProvider();
    (provider.verifyPayment as jest.Mock).mockResolvedValue('paid');
    const { db } = makeDb({
      subscriptions: [
        {
          id: 20,
          userId: 1,
          plan: 'plus',
          provider: 'sandbox',
          status: 'pending',
          externalRef: 'ref-x',
          currentPeriodStart: null,
          currentPeriodEnd: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      users: [aUser(1, 'free')],
    });
    const svc = new SubscriptionService(db, provider);
    const upgrade = jest.fn();
    svc.setHooks({ notifyUpgrade: upgrade });

    const first = await svc.finalizePending('ref-x');
    expect(first.activated).toBe(true);
    expect(upgrade).toHaveBeenCalledTimes(1);

    // duplicate callback: subscription is now active, so it short-circuits
    // and does not re-notify
    const second = await svc.finalizePending('ref-x');
    expect(second.activated).toBe(false);
    expect(upgrade).toHaveBeenCalledTimes(1);
  });
});
