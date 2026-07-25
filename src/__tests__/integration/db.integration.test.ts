import { eq } from 'drizzle-orm';
import { createTestDb, TestDbHandle, isConstraintViolation } from '../helpers/pg';
import { schema } from '../../db';
import { mergeAccounts } from '../../core/merge-accounts';
import { enforceMeterCap } from '../../core/meter-cap';
import { eraseUser } from '../../core/erase-user';
import { linkIdentity } from '../../core/identities';

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
    const web = await makeUser({ email: 'web@example.com' });
    await linkIdentity(h.db, web.id, { provider: 'email', email: 'web@example.com' });
    const bot = await makeUser({ telegramChatId: 555 });
    await linkIdentity(h.db, bot.id, { provider: 'telegram', chatId: 555 });
    const meter = await makeMeter(bot.id, 'M-bot');

    await expect(mergeAccounts(h.db, web.id, bot.id)).resolves.toBe('merged');

    const [survivor] = await h.db.select().from(schema.users).where(eq(schema.users.id, web.id));
    expect(survivor.telegramChatId).toBe(555);
    expect(survivor.email).toBe('web@example.com');

    const loserRows = await h.db.select().from(schema.users).where(eq(schema.users.id, bot.id));
    expect(loserRows).toHaveLength(0);

    // identity rows follow the survivor and match its columns
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
    const web = await makeUser({ email: 'a@example.com', telegramChatId: 111 });
    await linkIdentity(h.db, web.id, { provider: 'telegram', chatId: 111 });
    const bot = await makeUser({ telegramChatId: 222 });
    await linkIdentity(h.db, bot.id, { provider: 'telegram', chatId: 222 });

    expect(await mergeAccounts(h.db, web.id, bot.id)).toBe('merged');

    // the (user_id, provider) unique would reject a blind repoint of the loser's
    // telegram row; the survivor keeps exactly one, matching its own column
    const identities = await h.db
      .select()
      .from(schema.identities)
      .where(eq(schema.identities.userId, web.id));
    const telegram = identities.filter(i => i.provider === 'telegram');
    expect(telegram).toHaveLength(1);
    expect(telegram[0].providerUid).toBe('111');
  });
});

describe('unique indexes', () => {
  it('refuses to give one provider identity to two accounts', async () => {
    const a = await makeUser({ email: 'a@example.com' });
    const b = await makeUser({ email: 'b@example.com' });
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

  it('treats account emails case-insensitively', async () => {
    await makeUser({ email: 'Person@Example.com' });
    let error: unknown;
    try {
      await makeUser({ email: 'person@example.com' });
    } catch (e) {
      error = e;
    }
    expect(isConstraintViolation(error)).toBe(true);
  });

  it('lets many accounts stay emailless (partial index)', async () => {
    await makeUser({ telegramChatId: 1 });
    await makeUser({ telegramChatId: 2 });
    const rows = await h.db.select().from(schema.users);
    expect(rows).toHaveLength(2);
  });

  it('refuses the same physical meter twice on one account', async () => {
    const user = await makeUser({ email: 'm@example.com' });
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
    const user = await makeUser({ email: 'cap@example.com', plan: 'business', meterLimit: 2 });
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
    const user = await makeUser({ email: 'plan@example.com', plan: 'free' });
    await makeMeter(user.id, 'M1');
    await makeMeter(user.id, 'M2');
    expect(await enforceMeterCap(h.db, user.id, user.plan)).toBe(1); // free allows 1
  });
});

describe('eraseUser', () => {
  it('leaves nothing behind across every owned table', async () => {
    const user = await makeUser({ email: 'gone@example.com', telegramChatId: 777 });
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
