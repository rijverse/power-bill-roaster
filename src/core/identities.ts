import { and, eq, sql } from 'drizzle-orm';
import { Db, schema } from '../db';

// The normalized identity layer: one row per (user, provider) in the identities
// table, replacing the telegram_chat_id / discord_user_id / email columns that
// used to live on users. linkIdentity is the single path any surface (web hub,
// either bot) calls to connect a provider to an account; it never merges on its
// own - a collision with an account that already owns the identity comes back as
// 'needs-merge' so the caller can confirm first.
//
// While the readers are being ported (see the plan's expand/contract steps), the
// writers here ALSO keep the legacy users columns in sync so unported readers
// still work. That dual-write is removed once every reader reads identities.

export type Provider = 'telegram' | 'discord' | 'email';

export type LinkInput =
  | { provider: 'telegram'; chatId: number }
  | { provider: 'discord'; discordUserId: string }
  | { provider: 'email'; email: string };

export interface AcctSummary {
  userId: number;
  meterCount: number;
  plan: string;
}

export type LinkResult =
  | { status: 'linked' }
  | { status: 'already' }
  // The account already has this provider bound to a different id; disconnect
  // that one first. Prevented by the (user_id, provider) unique either way.
  | { status: 'provider-conflict'; existingUid: string }
  // The identity belongs to another account. The caller confirms, then merges.
  | {
      status: 'needs-merge';
      otherUserId: number;
      summary: { me: AcctSummary; other: AcctSummary };
    };

// The provider + provider_uid an input maps to. uid is the provider's own id:
// telegram chat id as text, Discord snowflake, or lower(email).
export function descriptorFor(input: LinkInput): { provider: Provider; uid: string } {
  switch (input.provider) {
    case 'telegram':
      return { provider: 'telegram', uid: String(input.chatId) };
    case 'discord':
      return { provider: 'discord', uid: input.discordUserId };
    case 'email':
      return { provider: 'email', uid: input.email.trim().toLowerCase() };
  }
}

// The verified delivery channel an identity implies (talking to the bot / owning
// the mailbox proves the address). Discord identity is the DM channel, not the
// 'discord' webhook channel, which is a separate delivery-only feature.
function channelFor(input: LinkInput): { type: string; address: string } {
  switch (input.provider) {
    case 'telegram':
      return { type: 'telegram', address: String(input.chatId) };
    case 'discord':
      return { type: 'discord-dm', address: input.discordUserId };
    case 'email':
      return { type: 'email', address: input.email.trim() };
  }
}

// The legacy users column an input writes to (dual-write during the transition).
function legacyIdentitySet(
  input: LinkInput
): Partial<{ telegramChatId: number; discordUserId: string; email: string }> {
  switch (input.provider) {
    case 'telegram':
      return { telegramChatId: input.chatId };
    case 'discord':
      return { discordUserId: input.discordUserId };
    case 'email':
      return { email: input.email.trim() };
  }
}

/** Meter count + plan for a merge-confirmation summary. */
async function summarize(db: Db, userId: number): Promise<AcctSummary> {
  const meters = await db
    .select({ id: schema.meters.id })
    .from(schema.meters)
    .where(eq(schema.meters.userId, userId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  return { userId, meterCount: meters.length, plan: user?.plan ?? 'free' };
}

/** Make sure the identity's delivery channel exists and is verified + enabled. */
async function ensureChannel(
  db: Db,
  userId: number,
  spec: { type: string; address: string }
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.userId, userId),
        eq(schema.channels.type, spec.type),
        eq(schema.channels.address, spec.address)
      )
    );
  if (!existing) {
    await db
      .insert(schema.channels)
      .values({ userId, type: spec.type, address: spec.address, verified: true, enabled: true });
  } else if (!existing.verified || !existing.enabled) {
    await db
      .update(schema.channels)
      .set({ verified: true, enabled: true })
      .where(eq(schema.channels.id, existing.id));
  }
}

/**
 * Disable every enabled email channel except the kept address. The dispatcher
 * fans out to every enabled email row, so a stale row keeps leaking balance mail
 * to an address the user may no longer control. Disabled, not deleted, because
 * alerts_log rows FK the channel and re-adding re-enables it. Shared by the email
 * link path and mergeAccounts (both can otherwise leave two enabled addresses).
 */
export async function retireStaleEmailChannels(
  db: Db,
  userId: number,
  keepAddress: string
): Promise<void> {
  const keep = keepAddress.toLowerCase();
  await db
    .update(schema.channels)
    .set({ enabled: false })
    .where(
      and(
        eq(schema.channels.userId, userId),
        eq(schema.channels.type, 'email'),
        sql`lower(${schema.channels.address}) <> ${keep}`
      )
    );
}

/** The identity row for (provider, uid), or null. */
async function identityByUid(
  db: Db,
  provider: Provider,
  uid: string
): Promise<schema.Identity | null> {
  const [row] = await db
    .select()
    .from(schema.identities)
    .where(and(eq(schema.identities.provider, provider), eq(schema.identities.providerUid, uid)));
  return row ?? null;
}

// The link outcome implied by an already-existing identity row (owned by the
// target -> 'already', owned by someone else -> 'needs-merge'), or null if the
// identity is unclaimed. Used both up front and after a losing insert race.
async function classifyExisting(
  db: Db,
  targetUserId: number,
  provider: Provider,
  uid: string
): Promise<LinkResult | null> {
  const existing = await identityByUid(db, provider, uid);
  if (!existing) {
    return null;
  }
  if (existing.userId === targetUserId) {
    return { status: 'already' };
  }
  return {
    status: 'needs-merge',
    otherUserId: existing.userId,
    summary: { me: await summarize(db, targetUserId), other: await summarize(db, existing.userId) },
  };
}

/**
 * Connect a provider identity to targetUserId. Inserts the identity + its
 * verified channel when the identity is unclaimed; reports 'already' if the
 * target already owns it, 'provider-conflict' if the target has a different id
 * for that provider, or 'needs-merge' if another account owns it (the caller
 * confirms and then calls mergeAccounts). Also dual-writes the legacy users
 * column during the transition.
 */
export async function linkIdentity(
  db: Db,
  targetUserId: number,
  input: LinkInput
): Promise<LinkResult> {
  const { provider, uid } = descriptorFor(input);

  const pre = await classifyExisting(db, targetUserId, provider, uid);
  if (pre) {
    if (pre.status === 'already') {
      await ensureChannel(db, targetUserId, channelFor(input));
    }
    return pre;
  }

  // The identity is free. Does the target already hold this provider on a
  // different id? The (user_id, provider) unique would reject the insert anyway;
  // catch it up front so the caller gets a clear outcome instead of a DB error.
  const [ownProvider] = await db
    .select()
    .from(schema.identities)
    .where(
      and(eq(schema.identities.userId, targetUserId), eq(schema.identities.provider, provider))
    );
  if (ownProvider) {
    return { status: 'provider-conflict', existingUid: ownProvider.providerUid };
  }

  try {
    await db
      .insert(schema.identities)
      .values({ userId: targetUserId, provider, providerUid: uid, verified: true });
  } catch {
    // Lost a race to another link for the same identity - re-resolve.
    const post = await classifyExisting(db, targetUserId, provider, uid);
    if (post) {
      return post;
    }
    throw new Error('identity insert failed');
  }

  await db
    .update(schema.users)
    .set(legacyIdentitySet(input))
    .where(eq(schema.users.id, targetUserId));
  if (input.provider === 'email') {
    await retireStaleEmailChannels(db, targetUserId, input.email.trim());
  }
  await ensureChannel(db, targetUserId, channelFor(input));
  return { status: 'linked' };
}

/**
 * Disconnect a provider from a user. Refuses to remove the user's last identity
 * (that would orphan the account - meters but no way back in). Deletes the
 * identity row, clears the legacy users column, and disables the matching
 * channel (telegram / discord-dm / that email row), leaving the 'discord'
 * webhook channel alone since it's delivery, not a login.
 */
export async function unlinkIdentity(
  db: Db,
  userId: number,
  provider: Provider
): Promise<{ status: 'unlinked' } | { status: 'last-identity' } | { status: 'not-found' }> {
  const rows = await db
    .select()
    .from(schema.identities)
    .where(eq(schema.identities.userId, userId));
  const target = rows.find(r => r.provider === provider);
  if (!target) {
    return { status: 'not-found' };
  }
  if (rows.length <= 1) {
    return { status: 'last-identity' };
  }

  await db.delete(schema.identities).where(eq(schema.identities.id, target.id));
  await db.update(schema.users).set(legacyClear(provider)).where(eq(schema.users.id, userId));

  if (provider === 'email') {
    await db
      .update(schema.channels)
      .set({ enabled: false })
      .where(
        and(
          eq(schema.channels.userId, userId),
          eq(schema.channels.type, 'email'),
          sql`lower(${schema.channels.address}) = ${target.providerUid}`
        )
      );
  } else {
    const channelType = provider === 'telegram' ? 'telegram' : 'discord-dm';
    await db
      .update(schema.channels)
      .set({ enabled: false })
      .where(and(eq(schema.channels.userId, userId), eq(schema.channels.type, channelType)));
  }
  return { status: 'unlinked' };
}

function legacyClear(
  provider: Provider
): Partial<{ telegramChatId: null; discordUserId: null; email: null }> {
  switch (provider) {
    case 'telegram':
      return { telegramChatId: null };
    case 'discord':
      return { discordUserId: null };
    case 'email':
      return { email: null };
  }
}

// ---- resolvers (used by the readers once they're ported off users.*) --------

/** The user owning a provider identity, or null. */
export async function findUserByProvider(
  db: Db,
  provider: Provider,
  uid: string
): Promise<schema.User | null> {
  const [row] = await db
    .select({ user: schema.users })
    .from(schema.identities)
    .innerJoin(schema.users, eq(schema.identities.userId, schema.users.id))
    .where(and(eq(schema.identities.provider, provider), eq(schema.identities.providerUid, uid)));
  return row?.user ?? null;
}

export async function identitiesForUser(db: Db, userId: number): Promise<schema.Identity[]> {
  return db.select().from(schema.identities).where(eq(schema.identities.userId, userId));
}

/**
 * A user's delivery targets, one per provider (or null). The single reader-facing
 * shape that replaces user.telegramChatId / user.discordUserId / user.email.
 */
export async function contactTargets(
  db: Db,
  userId: number
): Promise<{ telegramChatId: number | null; discordUserId: string | null; email: string | null }> {
  const rows = await identitiesForUser(db, userId);
  const tg = rows.find(r => r.provider === 'telegram');
  const dc = rows.find(r => r.provider === 'discord');
  const em = rows.find(r => r.provider === 'email');
  return {
    telegramChatId: tg ? Number(tg.providerUid) : null,
    discordUserId: dc ? dc.providerUid : null,
    email: em ? em.providerUid : null,
  };
}
