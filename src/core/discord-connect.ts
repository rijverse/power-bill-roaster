import { and, eq } from 'drizzle-orm';
import { Db, schema } from '../db';
import { DiscordEmbed, isValidDiscordWebhookUrl, sendDiscordAlert } from '../notifications/discord';
import { logger } from '../logger';

// Connecting a Discord webhook is always the same three steps - validate the URL,
// prove it's live with a test embed, then upsert a verified+enabled channel row -
// and it was written out three times (the Telegram bot's /discord, the Discord
// bot's /webhook, and the web app's Discord settings), each re-typing the same
// embed copy. The callers still own their own rate limiting and how they phrase
// the reply; only the mechanism lives here.

/** The "it works" embed. One copy, so the three entry points can't drift. */
export const CONNECTED_EMBED: DiscordEmbed = {
  title: 'Power Roast connected ✅',
  description:
    "Low-balance alerts for your meter(s) will land here. If you're reading this, it works.",
  color: 0x3ba55d, // green, matching COLOR.ok in the Discord bot
};

export type ConnectResult =
  { ok: true; address: string } | { ok: false; reason: 'invalid-url' | 'test-send-failed' };

/**
 * Validate a Discord webhook URL, test-send to it, and save it as the user's
 * verified Discord channel. Nothing is written unless the test send lands, so a
 * dead webhook can never end up stored as a working alert channel.
 */
export async function connectDiscordWebhook(
  db: Db,
  userId: number,
  url: unknown
): Promise<ConnectResult> {
  if (typeof url !== 'string' || !isValidDiscordWebhookUrl(url)) {
    return { ok: false, reason: 'invalid-url' };
  }
  try {
    await sendDiscordAlert(url, CONNECTED_EMBED);
  } catch (error) {
    logger.error(
      `Discord webhook test send failed for user ${userId}`,
      error instanceof Error ? error.message : error
    );
    return { ok: false, reason: 'test-send-failed' };
  }
  const existing = await discordWebhook(db, userId);
  if (existing) {
    await db
      .update(schema.channels)
      .set({ address: url, verified: true, enabled: true })
      .where(eq(schema.channels.id, existing.id));
  } else {
    await db.insert(schema.channels).values({
      userId,
      type: 'discord',
      address: url,
      verified: true,
      enabled: true,
    });
  }
  return { ok: true, address: url };
}

/** The user's Discord webhook channel row, if they have one. */
export async function discordWebhook(db: Db, userId: number): Promise<schema.Channel | undefined> {
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.userId, userId), eq(schema.channels.type, 'discord')));
  return channel;
}

/**
 * Pause Discord alerts. Disabled rather than deleted: alerts_log rows FK the
 * channel, and reconnecting just re-enables it.
 */
export async function disableDiscordWebhook(db: Db, userId: number): Promise<'off' | 'not-on'> {
  const existing = await discordWebhook(db, userId);
  if (!existing || !existing.enabled) {
    return 'not-on';
  }
  await db
    .update(schema.channels)
    .set({ enabled: false })
    .where(eq(schema.channels.id, existing.id));
  return 'off';
}
