import { eq, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';
import { METER_OWNED } from '../db/ownership';
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

// The identity we compare channels by. A 'telegram' row is a duplicate by type
// alone: post-merge the account has exactly one chat id, so a second row could
// only shadow the first (the dispatcher's gate reads one row).
type ChannelKeyParts = { id: number; type: string; address: string };
const channelKey = (c: ChannelKeyParts) =>
  c.type === 'telegram' ? 'telegram' : `${c.type}|${c.address.toLowerCase()}`;

/**
 * Loser channels the survivor already covers - these get disabled (not deleted;
 * alerts_log rows FK them) so a merge can't create double sends or an
 * ambiguously-toggled channel.
 */
export function shadowedChannelIds(
  survivorChannels: ChannelKeyParts[],
  loserChannels: ChannelKeyParts[]
): number[] {
  const survivorKeys = new Set(survivorChannels.map(channelKey));
  return loserChannels.filter(c => survivorKeys.has(channelKey(c))).map(c => c.id);
}

/** The survivor's post-merge identity: keep its own telegram/email/discord id, else inherit the loser's, and keep whichever plan is paid - so no login or paid plan is lost in a merge. */
export function mergedIdentity(
  survivor: {
    telegramChatId: number | null;
    email: string | null;
    discordUserId: string | null;
    plan: string;
  },
  loser: {
    telegramChatId: number | null;
    email: string | null;
    discordUserId: string | null;
    plan: string;
  }
): {
  telegramChatId: number | null;
  email: string | null;
  discordUserId: string | null;
  plan: string;
} {
  return {
    telegramChatId: survivor.telegramChatId ?? loser.telegramChatId,
    email: survivor.email ?? loser.email,
    discordUserId: survivor.discordUserId ?? loser.discordUserId,
    plan: survivor.plan !== 'free' ? survivor.plan : loser.plan,
  };
}

/**
 * Merge the loser account into the survivor: move meters (dropping duplicates the
 * survivor already has), channels, subscriptions, payments, and pending alerts,
 * then delete the loser and stamp the survivor with the merged identity columns
 * (each login the survivor lacked is inherited from the loser). Finally re-applies
 * the survivor's meter cap. All the row moves run in one transaction.
 */
export async function mergeAccounts(
  db: Db,
  survivorId: number,
  loserId: number
): Promise<'merged' | 'missing'> {
  const outcome = await db.transaction(async tx => {
    const [survivor] = await tx.select().from(schema.users).where(eq(schema.users.id, survivorId));
    const [loser] = await tx.select().from(schema.users).where(eq(schema.users.id, loserId));
    if (!survivor || !loser) {
      // Stale token or a concurrent merge already consumed one side. Signal it
      // so callers don't tell the user "Merged ✅" about a merge that didn't run.
      return { status: 'missing' as const, plan: survivor?.plan ?? 'free' };
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
      // A meter the survivor already has: its rows die with it. The table list and
      // its (children-first) order come from the registry, so this can't drift from
      // eraseUser's - which is the half of the problem ON DELETE CASCADE could not
      // have solved, since merge re-points FKs rather than deleting the parent.
      for (const owned of METER_OWNED) {
        await tx.delete(owned.table).where(inArray(owned.meterId!, dupIds));
      }
      await tx.delete(schema.meters).where(inArray(schema.meters.id, dupIds));
    }
    if (moveIds.length > 0) {
      await tx
        .update(schema.meters)
        .set({ userId: survivorId })
        .where(inArray(schema.meters.id, moveIds));
    }

    // Channels move like meters do: the survivor's copy of a duplicate wins.
    // Without this, two enabled rows of one type mean duplicate alert sends,
    // and the dispatcher's telegram gate would read an arbitrary row.
    const survivorChannels = await tx
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.userId, survivorId));
    const loserChannels = await tx
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.userId, loserId));
    const shadowedIds = shadowedChannelIds(survivorChannels, loserChannels);
    if (shadowedIds.length > 0) {
      await tx
        .update(schema.channels)
        .set({ enabled: false })
        .where(inArray(schema.channels.id, shadowedIds));
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

    const { telegramChatId, email, discordUserId, plan } = mergedIdentity(survivor, loser);
    // The loser's identity rows FK users with ON DELETE no action, so they have
    // to go before the user row (ownership.ts flags identities repointOnMerge -
    // this is where merge honors it). We rebuild the survivor's rows from the
    // merged columns below rather than repointing, since a same-provider
    // collision would trip the (user_id, provider) unique.
    await tx.delete(schema.identities).where(eq(schema.identities.userId, loserId));
    // Delete the loser first so its telegram_chat_id / discord_user_id /
    // lower(email) uniques are free before we stamp them onto the survivor.
    await tx.delete(schema.users).where(eq(schema.users.id, loserId));
    await tx
      .update(schema.users)
      .set({ telegramChatId, discordUserId, email, plan })
      .where(eq(schema.users.id, survivorId));
    // Keep the survivor's identity rows in step with the columns just stamped
    // (the dual-write invariant): one row per provider it now has, right uid.
    const wanted = [
      telegramChatId !== null ? { provider: 'telegram', uid: String(telegramChatId) } : null,
      discordUserId !== null ? { provider: 'discord', uid: discordUserId } : null,
      email !== null ? { provider: 'email', uid: email.toLowerCase() } : null,
    ].filter((x): x is { provider: string; uid: string } => x !== null);
    const survivorIds = await tx
      .select()
      .from(schema.identities)
      .where(eq(schema.identities.userId, survivorId));
    for (const row of survivorIds) {
      const want = wanted.find(w => w.provider === row.provider);
      if (!want || want.uid !== row.providerUid) {
        await tx.delete(schema.identities).where(eq(schema.identities.id, row.id));
      }
    }
    const kept = new Set(
      survivorIds
        .filter(row => wanted.some(w => w.provider === row.provider && w.uid === row.providerUid))
        .map(row => row.provider)
    );
    for (const w of wanted) {
      if (!kept.has(w.provider)) {
        await tx.insert(schema.identities).values({
          userId: survivorId,
          provider: w.provider,
          providerUid: w.uid,
          verified: true,
        });
      }
    }
    return { status: 'merged' as const, plan };
  });

  // Idempotent, so it's fine just outside the transaction.
  await enforceMeterCap(db, survivorId, outcome.plan);
  return outcome.status;
}
