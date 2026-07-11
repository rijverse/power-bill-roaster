import { eraseUser } from '../../core/erase-user';
import { Db, schema } from '../../db';
import { USER_OWNED } from '../../db/ownership';

// Records the order tables are deleted in. pending_alerts FKs both meters and
// users with no cascade, so it must be cleared before either - a regression
// here means /delete dies with a constraint violation for any user who ever
// had an alert queued.
function fakeDb(meterIds: number[]) {
  const deleted: unknown[] = [];
  const tx = {
    select: () => ({
      from: () => ({ where: async () => meterIds.map(id => ({ id })) }),
    }),
    delete: (table: unknown) => ({ where: async () => void deleted.push(table) }),
  };
  const db = {
    transaction: async (fn: (t: unknown) => Promise<void>) => fn(tx),
  } as unknown as Db;
  return { db, deleted };
}

describe('eraseUser', () => {
  it('clears pending_alerts before deleting meters and users', async () => {
    const { db, deleted } = fakeDb([7, 8]);
    await eraseUser(db, 1);

    expect(deleted).toContain(schema.pendingAlerts);
    expect(deleted.indexOf(schema.pendingAlerts)).toBeLessThan(deleted.indexOf(schema.meters));
    expect(deleted.lastIndexOf(schema.pendingAlerts)).toBeLessThan(
      deleted.indexOf(schema.users)
    );
    // the rest of the erasure promise still holds
    expect(deleted).toContain(schema.alertsLog);
    expect(deleted).toContain(schema.readings);
    expect(deleted).toContain(schema.channels);
    expect(deleted).toContain(schema.subscriptions);
    expect(deleted[deleted.length - 1]).toBe(schema.users);
  });

  it('clears payments before subscriptions and users (both FK it, no cascade)', async () => {
    // regression: a user with any payment row (billing was live before the
    // free-only launch) must still be erasable - forgetting payments makes the
    // whole transaction roll back on the FK and /delete crash.
    const { db, deleted } = fakeDb([7]);
    await eraseUser(db, 1);

    expect(deleted).toContain(schema.payments);
    expect(deleted.indexOf(schema.payments)).toBeLessThan(deleted.indexOf(schema.subscriptions));
    expect(deleted.indexOf(schema.payments)).toBeLessThan(deleted.indexOf(schema.users));
  });

  it('still clears user-keyed pending_alerts when the user has no meters', async () => {
    const { db, deleted } = fakeDb([]);
    await eraseUser(db, 1);
    expect(deleted).toContain(schema.pendingAlerts);
    expect(deleted[deleted.length - 1]).toBe(schema.users);
  });

  it('erases every table in the registry, derived - not a hand-written allowlist', async () => {
    // The assertions above name tables by hand, which is exactly the habit that
    // let pending_alerts and payments get forgotten in the first place. This one is
    // derived from USER_OWNED, and ownership.test.ts proves USER_OWNED covers the
    // schema's foreign keys - so a new user-owned table is caught end to end.
    const { db, deleted } = fakeDb([7]);
    await eraseUser(db, 1);

    for (const owned of USER_OWNED) {
      expect(deleted).toContain(owned.table);
    }
    expect(deleted[deleted.length - 1]).toBe(schema.users);
  });
});
