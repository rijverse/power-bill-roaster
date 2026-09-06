import { eq } from 'drizzle-orm';
import { createTestDb, TestDbHandle, isConstraintViolation } from '../helpers/pg';
import { schema } from '../../db';
import { mergeAccounts } from '../../core/merge-accounts';
import { enforceMeterCap } from '../../core/meter-cap';
import { eraseUser } from '../../core/erase-user';
import { linkIdentity, unlinkIdentity } from '../../core/identities';

// Constraint-level behavior against a real Postgres. Everything here is a thing
// the in-memory fakes cannot express: an FK that refuses a delete, a unique index
// that rejects a duplicate, a transaction that rolls back.

let h: TestDbHandle;

beforeAll(async () => {
  h = await createTestDb();
}, 60_000);

afterAll(async () => {
  await h?.close();
});

// Each test starts from an empty set of rows, children first so FKs allow it.
beforeEach(async () => {
  await h.db.delete(schema.alertsLog);
  await h.db.delete(schema.alertState);
  await h.db.delete(schema.readings);
  await h.db.delete(schema.pendingAlerts);
  await h.db.delete(schema.meters);
  await h.db.delete(schema.channels);
  await h.db.delete(schema.identities);
  await h.db.delete(schema.payments);
  await h.db.delete(schema.subscriptions);
  await h.db.delete(schema.users);
});

async function makeUser(values: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await h.db.insert(schema.users).values(values).returning();
  return user;
}

async function makeMeter(userId: number, meterNo: string, active = true) {
  const [meter] = await h.db
    .insert(schema.meters)
    .values({ userId, provider: 'desco', accountNo: '12345678', meterNo, active })
    .returning();
  return meter;
}

describe('mergeAccounts against real constraints', () => {
  it('merges a bot account holding an identity row without tripping the FK', async () => {
    // The exact shape that used to throw: identities.user_id is ON DELETE no
    // action, and merge deletes the loser's users row.
    const web = await makeUser();
    await linkIdentity(h.db, web.id, { provider: 'email', email: 'web@example.com' });
    const bot = await makeUser();
    await linkIdentity(h.db, bot.id, { provider: 'telegram', chatId: 555 });
    const meter = await makeMeter(bot.id, 'M-bot');

    await expect(mergeAccounts(h.db, web.id, bot.id)).resolves.toBe('merged');

    const loserRows = await h.db.select().from(schema.users).where(eq(schema.users.id, bot.id));
    expect(loserRows).toHaveLength(0);

    // both identity rows now hang off the survivor
    const identities = await h.db
      .select()
      .from(schema.identities)
      .where(eq(schema.identities.userId, web.id));
    expect(identities.map(i => `${i.provider}:${i.providerUid}`).sort()).toEqual([
      'email:web@example.com',
      'telegram:555',
    ]);
    // no identity row survives pointing at the deleted account
    const orphans = await h.db
      .select()
      .from(schema.identities)
      .where(eq(schema.identities.userId, bot.id));
    expect(orphans).toHaveLength(0);

    // and the loser's meter came along
    const [moved] = await h.db.select().from(schema.meters).where(eq(schema.meters.id, meter.id));
    expect(moved.userId).toBe(web.id);
  });

  it('keeps the survivor a single identity per provider when both sides have one', async () => {
    const web = await makeUser();
    await linkIdentity(h.db, web.id, { provider: 'telegram', chatId: 111 });
    const bot = await makeUser();
    await linkIdentity(h.db, bot.id, { provider: 'telegram', chatId: 222 });

    expect(await mergeAccounts(h.db, web.id, bot.id)).toBe('merged');

    // the (user_id, provider) unique would reject a blind repoint of the loser's
    // telegram row; the survivor keeps exactly one, its own
    const identities = await h.db
      .select()
      .from(schema.identities)
      .where(eq(schema.identities.userId, web.id));
    const telegram = identities.filter(i => i.provider === 'telegram');
    expect(telegram).toHaveLength(1);
    expect(telegram[0].providerUid).toBe('111');
  });

  it("disables the loser's stale email channel so the survivor keeps one address", async () => {
    // Two email accounts merge (the duplicate-by-email case). The survivor keeps
    // its own address; the loser's email channel is repointed but must be turned
    // off, or the dispatcher fans balance mail to both addresses.
    const survivor = await makeUser();
    await linkIdentity(h.db, survivor.id, { provider: 'email', email: 'keep@example.com' });
    const loser = await makeUser();
    await linkIdentity(h.db, loser.id, { provider: 'email', email: 'old@example.com' });

    expect(await mergeAccounts(h.db, survivor.id, loser.id)).toBe('merged');

    const channels = await h.db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.userId, survivor.id));
    expect(channels.find(c => c.address === 'keep@example.com')?.enabled).toBe(true);
    expect(channels.find(c => c.address === 'old@example.com')?.enabled).toBe(false);
  });
});

describe('unlinkIdentity', () => {
  it('drops a method when others remain, and refuses to remove the last one', async () => {
    const user = await makeUser();
    await linkIdentity(h.db, user.id, { provider: 'email', email: 'multi@example.com' });
    await linkIdentity(h.db, user.id, { provider: 'telegram', chatId: 321 });

    // telegram goes (email still lets them in): identity gone and the telegram
    // channel turned off
    expect(await unlinkIdentity(h.db, user.id, 'telegram')).toEqual({ status: 'unlinked' });
    const ids = await h.db
      .select()
      .from(schema.identities)
      .where(eq(schema.identities.userId, user.id));
    expect(ids.map(i => i.provider)).toEqual(['email']);
    const chans = await h.db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.userId, user.id));
    expect(chans.find(c => c.type === 'telegram')?.enabled).toBe(false);

    // email is now the only way in, so it can't be removed
    expect(await unlinkIdentity(h.db, user.id, 'email')).toEqual({ status: 'last-identity' });
  });
});

describe('unique indexes', () => {
  it('refuses to give one provider identity to two accounts', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await h.db
      .insert(schema.identities)
      .values({ userId: a.id, provider: 'telegram', providerUid: '900' });
    let error: unknown;
    try {
      await h.db
        .insert(schema.identities)
        .values({ userId: b.id, provider: 'telegram', providerUid: '900' });
    } catch (e) {
      error = e;
    }
    expect(isConstraintViolation(error)).toBe(true);
  });

  it('treats email identities case-insensitively', async () => {
    // stored lower-cased on the identity, so a differently-cased same address is
    // recognized as the same login (comes back as needs-merge, not a new row).
    const a = await makeUser();
    await linkIdentity(h.db, a.id, { provider: 'email', email: 'Person@Example.com' });
    const b = await makeUser();
    const result = await linkIdentity(h.db, b.id, {
      provider: 'email',
      email: 'person@example.com',
    });
    expect(result.status).toBe('needs-merge');
  });

  it('refuses the same physical meter twice on one account', async () => {
    const user = await makeUser();
    await makeMeter(user.id, 'M1');
    let error: unknown;
    try {
      await makeMeter(user.id, 'M1');
    } catch (e) {
      error = e;
    }
    expect(isConstraintViolation(error)).toBe(true);
  });
});

describe('enforceMeterCap against real rows', () => {
  it('pauses everything past the operator override, oldest kept', async () => {
    const user = await makeUser({ plan: 'business', meterLimit: 2 });
    const first = await makeMeter(user.id, 'M1');
    await makeMeter(user.id, 'M2');
    const third = await makeMeter(user.id, 'M3');

    // business is unlimited by plan, so only the override can cause a pause
    expect(await enforceMeterCap(h.db, user.id, user.plan)).toBe(1);

    const [oldest] = await h.db.select().from(schema.meters).where(eq(schema.meters.id, first.id));
    const [newest] = await h.db.select().from(schema.meters).where(eq(schema.meters.id, third.id));
    expect(oldest.active).toBe(true);
    expect(newest.active).toBe(false);
  });

  it('falls back to the plan when no override is set', async () => {
    const user = await makeUser({ plan: 'free' });
    await makeMeter(user.id, 'M1');
    await makeMeter(user.id, 'M2');
    expect(await enforceMeterCap(h.db, user.id, user.plan)).toBe(1); // free allows 1
  });
});

describe('eraseUser', () => {
  it('leaves nothing behind across every owned table', async () => {
    const user = await makeUser();
    await linkIdentity(h.db, user.id, { provider: 'telegram', chatId: 777 });
    const meter = await makeMeter(user.id, 'M-gone');
    await h.db.insert(schema.readings).values({ meterId: meter.id, balance: 42 });
    await h.db
      .insert(schema.channels)
      .values({ userId: user.id, type: 'email', address: 'gone@example.com', verified: true });

    await eraseUser(h.db, user.id);

    // the FK-ordered delete has to clear children before the parent, or Postgres
    // rejects it - which is exactly what a fake can never tell us
    expect(await h.db.select().from(schema.users)).toHaveLength(0);
    expect(await h.db.select().from(schema.identities)).toHaveLength(0);
    expect(await h.db.select().from(schema.meters)).toHaveLength(0);
    expect(await h.db.select().from(schema.readings)).toHaveLength(0);
    expect(await h.db.select().from(schema.channels)).toHaveLength(0);
  });
});
