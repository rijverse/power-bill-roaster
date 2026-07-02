import { eq, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';
import { enforceMeterCap } from './meter-cap';

// The identity we compare meters by: a user can't hold the same physical meter
// twice (the DB has a unique index on exactly this tuple).
type MeterKeyParts = { id: number; provider: string; accountNo: string; meterNo: string };
const meterKey = (m: MeterKeyParts) => `${m.provider}|${m.accountNo}|${m.meterNo}`;

/** Which account keeps its identity in a merge. Prefer the one with a live plan; on a tie, the web account (email is the durable login). */
export function chooseSurvivor(
  web: { id: number; hasSubscription: boolean },
  bot: { id: number; hasSubscription: boolean }
): { survivorId: number; loserId: number } {
  if (bot.hasSubscription && !web.hasSubscription) {
    return { survivorId: bot.id, loserId: web.id };
  }
  return { survivorId: web.id, loserId: bot.id };
}

/**
 * Split the loser's meters into ones the survivor already has (drop these) and
 * ones to move over. Keeps the survivor's copy of any shared meter.
 */
export function partitionMeters(
  survivorMeters: MeterKeyParts[],
  loserMeters: MeterKeyParts[]
): { dupIds: number[]; moveIds: number[] } {
  const survivorKeys = new Set(survivorMeters.map(meterKey));
  const dupIds: number[] = [];
  const moveIds: number[] = [];
  for (const m of loserMeters) {
    (survivorKeys.has(meterKey(m)) ? dupIds : moveIds).push(m.id);
  }
  return { dupIds, moveIds };
}

/** The survivor's post-merge email and plan: keep its own, else inherit the loser's (so a paid plan / email survives). */
export function mergedIdentity(
  survivor: { email: string | null; plan: string },
  loser: { email: string | null; plan: string }
): { email: string | null; plan: string } {
  return {
    email: survivor.email ?? loser.email,
    plan: survivor.plan !== 'free' ? survivor.plan : loser.plan,
  };
}

/**
 * Merge the loser account into the survivor: move meters (dropping duplicates the
 * survivor already has), channels, subscriptions, payments, and pending alerts,
 * then delete the loser and stamp the survivor with the linking Telegram chat id
 * (plus the loser's email/plan if the survivor lacked them). Finally re-applies
 * the survivor's meter cap. All the row moves run in one transaction.
 */
export async function mergeAccounts(
  db: Db,
  survivorId: number,
  loserId: number,
  telegramChatId: number
): Promise<void> {
  const finalPlan = await db.transaction(async tx => {
    const [survivor] = await tx.select().from(schema.users).where(eq(schema.users.id, survivorId));
    const [loser] = await tx.select().from(schema.users).where(eq(schema.users.id, loserId));
    if (!survivor || !loser) {
      return survivor?.plan ?? 'free';
    }

    const survivorMeters = await tx
      .select()
      .from(schema.meters)
      .where(eq(schema.meters.userId, survivorId));
    const loserMeters = await tx
      .select()
      .from(schema.meters)
      .where(eq(schema.meters.userId, loserId));
    const { dupIds, moveIds } = partitionMeters(survivorMeters, loserMeters);

    if (dupIds.length > 0) {
      await tx.delete(schema.alertsLog).where(inArray(schema.alertsLog.meterId, dupIds));
      await tx.delete(schema.alertState).where(inArray(schema.alertState.meterId, dupIds));
      await tx.delete(schema.readings).where(inArray(schema.readings.meterId, dupIds));
      await tx.delete(schema.pendingAlerts).where(inArray(schema.pendingAlerts.meterId, dupIds));
      await tx.delete(schema.meters).where(inArray(schema.meters.id, dupIds));
    }
    if (moveIds.length > 0) {
      await tx
        .update(schema.meters)
        .set({ userId: survivorId })
        .where(inArray(schema.meters.id, moveIds));
    }

    await tx
      .update(schema.channels)
      .set({ userId: survivorId })
      .where(eq(schema.channels.userId, loserId));
    await tx
      .update(schema.subscriptions)
      .set({ userId: survivorId })
      .where(eq(schema.subscriptions.userId, loserId));
    await tx
      .update(schema.payments)
      .set({ userId: survivorId })
      .where(eq(schema.payments.userId, loserId));
    await tx
      .update(schema.pendingAlerts)
      .set({ userId: survivorId })
      .where(eq(schema.pendingAlerts.userId, loserId));

    const { email, plan } = mergedIdentity(survivor, loser);
    // Delete the loser first so its telegram_chat_id / lower(email) uniques are
    // free before we stamp them onto the survivor.
    await tx.delete(schema.users).where(eq(schema.users.id, loserId));
    await tx
      .update(schema.users)
      .set({ telegramChatId, email, plan })
      .where(eq(schema.users.id, survivorId));
    return plan;
  });

  // Idempotent, so it's fine just outside the transaction.
  await enforceMeterCap(db, survivorId, finalPlan);
}
