import { and, eq } from 'drizzle-orm';
import { Db, schema } from '../db';

// Account + meter use-cases shared by the chat adapters (Telegram bot,
// Discord bot). The adapters own their own conversation flow and rate
// limiting; the actual state changes they trigger (ensureUser, upsertMeter,
// applyThresholdsForUser) live here so the two platforms can't drift apart
// on what "register" or "set thresholds" actually does.

export type PlatformIdentity =
  | { kind: 'telegram'; chatId: number }
  | { kind: 'discord'; discordUserId: string };

export async function findUserByIdentity(
  db: Db,
  identity: PlatformIdentity
): Promise<schema.User | null> {
  const condition =
    identity.kind === 'telegram'
      ? eq(schema.users.telegramChatId, identity.chatId)
      : eq(schema.users.discordUserId, identity.discordUserId);
  const [user] = await db.select().from(schema.users).where(condition);
  return user ?? null;
}

/**
 * The user for a platform identity, created on first contact along with the
 * verified alert-channel row for that platform (talking to the bot proves the
 * address is theirs - same reasoning as the Telegram channel row).
 */
export async function ensureUser(db: Db, identity: PlatformIdentity): Promise<schema.User> {
  const existing = await findUserByIdentity(db, identity);
  if (existing) {
    return existing;
  }
  const [user] = await db
    .insert(schema.users)
    .values(
      identity.kind === 'telegram'
        ? { telegramChatId: identity.chatId }
        : { discordUserId: identity.discordUserId }
    )
    .returning();
  await db.insert(schema.channels).values({
    userId: user.id,
    type: identity.kind === 'telegram' ? 'telegram' : 'discord-dm',
    address: identity.kind === 'telegram' ? String(identity.chatId) : identity.discordUserId,
    verified: true,
  });
  return user;
}

/** Active meters for a user, oldest first. */
export async function activeMeters(db: Db, userId: number): Promise<schema.Meter[]> {
  return db
    .select()
    .from(schema.meters)
    .where(and(eq(schema.meters.userId, userId), eq(schema.meters.active, true)));
}

/**
 * Attach an already-verified meter to a user: re-activate the row if they
 * registered this meter before (keeping its thresholds and history), insert a
 * fresh one otherwise. Verification against the provider happens in the
 * adapter, before this - never store a meter DESCO didn't confirm.
 */
export async function upsertMeter(
  db: Db,
  userId: number,
  accountNo: string,
  meterNo: string,
  defaults: { low: number; critical: number }
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.meters)
    .where(
      and(
        eq(schema.meters.userId, userId),
        eq(schema.meters.accountNo, accountNo),
        eq(schema.meters.meterNo, meterNo)
      )
    );
  if (existing) {
    await db.update(schema.meters).set({ active: true }).where(eq(schema.meters.id, existing.id));
  } else {
    await db.insert(schema.meters).values({
      userId,
      provider: 'desco',
      accountNo,
      meterNo,
      lowThreshold: defaults.low,
      criticalThreshold: defaults.critical,
    });
  }
}

/**
 * Apply one low/critical pair to every active meter the user has (both bots
 * keep all meters in sync). Returns how many meters were updated. Callers
 * validate the numbers (critical below low, non-negative) before calling.
 */
export async function applyThresholdsForUser(
  db: Db,
  userId: number,
  low: number,
  critical: number
): Promise<number> {
  const meters = await activeMeters(db, userId);
  for (const meter of meters) {
    await db
      .update(schema.meters)
      .set({ lowThreshold: low, criticalThreshold: critical })
      .where(eq(schema.meters.id, meter.id));
  }
  return meters.length;
}
