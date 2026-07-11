import { eq, and, gte, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';
import { AlertAction, AlertLevel } from '../core/alert-machine';
import { smsPerMonthFor } from '../core/plans';
import { normalizeTone, Tone } from '../core/tone';
import { renderAlert, MeterContext } from './telegram-templates';
import { smsAlertText } from './sms-templates';
import { emailAlert } from './email-templates';
import { discordAlertEmbed } from './discord-templates';
import { sendDiscordAlert as postDiscordWebhook, DiscordEmbed } from './discord';
import { SmsGateway } from './sms';
import { Mailer } from '../services/mailer';
import { logger, maskEmail, maskPhone, maskWebhookUrl } from '../logger';

/** A button on an alert message: a link, or a callback the bot handles. */
export type AlertButton = { text: string; url: string } | { text: string; callbackData: string };

export interface TelegramSender {
  sendTelegram(chatId: number, text: string, buttons?: AlertButton[][]): Promise<void>;
}

/** DMs a Discord user (the Discord bot's REST client in production). */
export interface DiscordDmSender {
  sendDm(discordUserId: string, embed: DiscordEmbed): Promise<void>;
}

// Fallback only - the scheduler always sets ctx.rechargeUrl from config.
const DEFAULT_RECHARGE_URL = 'https://prepaid.desco.org.bd/';

/**
 * Result of one dispatch pass. `delivered` and `failed` hold channel keys -
 * 'telegram', 'email:<channelId>', 'sms:<channelId>', 'discord:<channelId>' - so the worker marks the
 * row sent only when nothing failed, and on a retry re-sends just the failed
 * ones and skips the rest. A channel we deliberately skip (disabled, no SMS
 * budget) shows up in neither list.
 */
export interface DispatchResult {
  delivered: string[];
  failed: string[];
}

function empty(): DispatchResult {
  return { delivered: [], failed: [] };
}

/**
 * Fans an alert out to every channel the user has: Telegram always (free),
 * email and Discord to verified webhooks/addresses (both free, so reminders and
 * recovery go too), and SMS only for low/critical, only on plans with an SMS
 * budget, and only while this month's budget holds. Every delivery attempt is
 * logged to alerts_log.
 *
 * Returns a {@link DispatchResult}: each channel send is isolated so one
 * channel's failure never aborts another, and the caller (the outbox worker)
 * uses the result to retry only what actually failed.
 */
export class Dispatcher {
  constructor(
    private db: Db,
    private telegram: TelegramSender,
    private sms: SmsGateway | null,
    private mailer: Mailer | null = null,
    private discordDm: DiscordDmSender | null = null
  ) {}

  async dispatchAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    alreadyDelivered: ReadonlySet<string> = new Set()
  ): Promise<DispatchResult> {
    // Quiet hours are the outbox worker's concern: it defers the row until the
    // window ends instead of asking us to skip (which would read as "sent").
    const tone = normalizeTone(user.tonePref);
    // Channels are independent and each isolates its own errors (runChannel),
    // so send in parallel - alert latency is the slowest channel, not the sum.
    const results = await Promise.all([
      this.runChannel('telegram', () =>
        this.sendTelegramAlert(user, meter, action, level, ctx, tone, alreadyDelivered)
      ),
      this.runChannel('email', () =>
        this.sendEmailAlert(user, meter, action, level, ctx, tone, alreadyDelivered)
      ),
      this.runChannel('sms', () =>
        this.sendSmsAlert(user, meter, action, level, ctx, tone, alreadyDelivered)
      ),
      this.runChannel('discord', () =>
        this.sendDiscordAlert(user, meter, action, level, ctx, tone, alreadyDelivered)
      ),
      this.runChannel('discord-dm', () =>
        this.sendDiscordDmAlert(user, meter, action, level, ctx, tone, alreadyDelivered)
      ),
    ]);
    return {
      delivered: results.flatMap(r => r.delivered),
      failed: results.flatMap(r => r.failed),
    };
  }

  // Isolate a channel so its unexpected error (e.g. a failing channels query)
  // can't discard another channel's success and cause a duplicate resend. A
  // thrown channel is reported failed under a group key so the worker retries
  // it; nothing was delivered, so there's nothing to wrongly skip next time.
  private async runChannel(
    group: string,
    fn: () => Promise<DispatchResult>
  ): Promise<DispatchResult> {
    try {
      return await fn();
    } catch (error) {
      logger.error(
        `${group} alert dispatch errored for a meter`,
        error instanceof Error ? error.message : error
      );
      return { delivered: [], failed: [group] };
    }
  }

  // alerts_log is the audit trail; a write failure here must not bubble up and
  // undo a successful send (which would make the worker resend it on retry).
  private async logDelivery(values: typeof schema.alertsLog.$inferInsert): Promise<void> {
    try {
      await this.db.insert(schema.alertsLog).values(values);
    } catch (error) {
      logger.error(
        'Failed to write alerts_log row',
        error instanceof Error ? error.message : error
      );
    }
  }

  private async sendEmailAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone,
    alreadyDelivered: ReadonlySet<string>
  ): Promise<DispatchResult> {
    if (!this.mailer) {
      return empty();
    }
    const content = emailAlert(action, ctx, tone);
    if (!content) {
      return empty();
    }
    // verified=true means the address is confirmed (web magic-link sign-in or
    // an explicit opt-in); unverified/disabled channels never receive mail
    const emailChannels = await this.db
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.userId, user.id),
          eq(schema.channels.type, 'email'),
          eq(schema.channels.enabled, true),
          eq(schema.channels.verified, true)
        )
      );
    const delivered: string[] = [];
    const failed: string[] = [];
    for (const channel of emailChannels) {
      const key = `email:${channel.id}`;
      if (alreadyDelivered.has(key)) {
        continue; // delivered on a previous attempt - don't resend
      }
      let ok = true;
      try {
        await this.mailer.send(channel.address, content.subject, content.text, content.html);
      } catch (error) {
        ok = false;
        logger.error(
          `Email alert failed for meter ${meter.id} to ${maskEmail(channel.address)}`,
          error instanceof Error ? error.message : error
        );
      }
      await this.logDelivery({
        meterId: meter.id,
        channelId: channel.id,
        level,
        action,
        deliveryStatus: ok ? 'sent' : 'failed',
      });
      (ok ? delivered : failed).push(key);
    }
    return { delivered, failed };
  }

  private async sendTelegramAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone,
    alreadyDelivered: ReadonlySet<string>
  ): Promise<DispatchResult> {
    const message = renderAlert(action, ctx, tone);
    if (!message || user.telegramChatId === null) {
      return empty();
    }
    const key = 'telegram';
    if (alreadyDelivered.has(key)) {
      return empty(); // delivered on a previous attempt - don't resend
    }
    // Telegram has no per-address row by default (it rides user.telegramChatId);
    // a 'telegram' channel row exists only once the user toggles it. Respect it.
    // Oldest row wins deterministically - an account merge can leave two.
    const tgRows = await this.db
      .select()
      .from(schema.channels)
      .where(and(eq(schema.channels.userId, user.id), eq(schema.channels.type, 'telegram')));
    const tgChannel = tgRows.reduce<schema.Channel | undefined>(
      (oldest, c) => (!oldest || c.id < oldest.id ? c : oldest),
      undefined
    );
    if (tgChannel && !tgChannel.enabled) {
      return empty();
    }
    // Recovery is good news with nothing to act on; every other alert gets a
    // one-tap recharge link and a snooze button (snooze mutes the repeat nag).
    // Low/critical alerts also get a "check again" button to re-poll on demand.
    const firstRow: AlertButton[] = [
      { text: '💳 Recharge now', url: ctx.rechargeUrl ?? DEFAULT_RECHARGE_URL },
    ];
    if (action === 'low-alert' || action === 'critical-alert') {
      firstRow.push({ text: '🔄 Check again', callbackData: `recheck:${meter.id}` });
    }
    const buttons: AlertButton[][] | undefined =
      action === 'recovery'
        ? undefined
        : [firstRow, [{ text: '🔕 Snooze 3 days', callbackData: `snooze:${meter.id}` }]];
    let ok = true;
    try {
      await this.telegram.sendTelegram(user.telegramChatId, message, buttons);
    } catch (error) {
      ok = false;
      logger.error(
        `Telegram alert failed for meter ${meter.id}`,
        error instanceof Error ? error.message : error
      );
    }
    await this.logDelivery({
      meterId: meter.id,
      level,
      action,
      deliveryStatus: ok ? 'sent' : 'failed',
    });
    return ok ? { delivered: [key], failed: [] } : { delivered: [], failed: [key] };
  }

  private async sendSmsAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone,
    alreadyDelivered: ReadonlySet<string>
  ): Promise<DispatchResult> {
    if (!this.sms) {
      return empty();
    }
    const text = smsAlertText(action, ctx, tone);
    if (!text) {
      return empty(); // reminders/recovery don't burn paid segments
    }
    const budget = smsPerMonthFor(user.plan);
    if (budget === 0) {
      return empty();
    }

    // verified=true means the user proved they own the number (OTP) -
    // unverified channels never receive a message
    const smsChannels = await this.db
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.userId, user.id),
          eq(schema.channels.type, 'sms'),
          eq(schema.channels.enabled, true),
          eq(schema.channels.verified, true)
        )
      );
    if (smsChannels.length === 0) {
      return empty();
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const usedThisMonth = await this.db.$count(
      schema.alertsLog,
      and(
        inArray(
          schema.alertsLog.channelId,
          smsChannels.map(c => c.id)
        ),
        gte(schema.alertsLog.sentAt, monthStart),
        eq(schema.alertsLog.deliveryStatus, 'sent')
      )
    );
    if (usedThisMonth >= budget) {
      logger.warn(`User ${user.id} hit the monthly SMS budget (${budget}), skipping SMS`);
      return empty();
    }

    // The budget is the hard cap on billable segments. Decrement per successful
    // send so a user with several verified numbers can't overshoot it in a
    // single fan-out (failed sends don't burn budget, matching usedThisMonth).
    let remaining = budget - usedThisMonth;
    const delivered: string[] = [];
    const failed: string[] = [];
    for (const channel of smsChannels) {
      const key = `sms:${channel.id}`;
      // Already delivered on a previous attempt: skip without touching budget -
      // its 'sent' row is already counted in usedThisMonth above.
      if (alreadyDelivered.has(key)) {
        continue;
      }
      if (remaining <= 0) {
        logger.warn(`User ${user.id} reached the SMS budget (${budget}) mid-alert, stopping`);
        break;
      }
      let ok = true;
      try {
        await this.sms.send(channel.address, text);
      } catch (error) {
        ok = false;
        logger.error(
          `SMS alert failed for meter ${meter.id} via ${this.sms.name} to ${maskPhone(channel.address)}`,
          error instanceof Error ? error.message : error
        );
      }
      await this.logDelivery({
        meterId: meter.id,
        channelId: channel.id,
        level,
        action,
        deliveryStatus: ok ? 'sent' : 'failed',
      });
      if (ok) {
        remaining--;
        delivered.push(key);
      } else {
        failed.push(key);
      }
    }
    return { delivered, failed };
  }

  // The Discord *bot* channel. Same idea as the webhook channel - free, full
  // action set - but delivery is a DM through the bot instead of a webhook
  // post. The 'discord-dm' channel row is created verified at registration
  // (running a slash command proves the user controls that snowflake).
  // The DM itself can still fail (closed DMs, bot blocked). That's a failed
  // delivery, the outbox retries it.
  private async sendDiscordDmAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone,
    alreadyDelivered: ReadonlySet<string>
  ): Promise<DispatchResult> {
    if (!this.discordDm) {
      return empty();
    }
    const embed = discordAlertEmbed(action, ctx, tone);
    if (!embed) {
      return empty();
    }
    const dmChannels = await this.db
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.userId, user.id),
          eq(schema.channels.type, 'discord-dm'),
          eq(schema.channels.enabled, true),
          eq(schema.channels.verified, true)
        )
      );
    const delivered: string[] = [];
    const failed: string[] = [];
    for (const channel of dmChannels) {
      const key = `discord-dm:${channel.id}`;
      if (alreadyDelivered.has(key)) {
        continue; // delivered on a previous attempt - don't resend
      }
      let ok = true;
      try {
        await this.discordDm.sendDm(channel.address, embed);
      } catch (error) {
        ok = false;
        logger.error(
          `Discord DM alert failed for meter ${meter.id}`,
          error instanceof Error ? error.message : error
        );
      }
      await this.logDelivery({
        meterId: meter.id,
        channelId: channel.id,
        level,
        action,
        deliveryStatus: ok ? 'sent' : 'failed',
      });
      (ok ? delivered : failed).push(key);
    }
    return { delivered, failed };
  }

  private async sendDiscordAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone,
    alreadyDelivered: ReadonlySet<string>
  ): Promise<DispatchResult> {
    const embed = discordAlertEmbed(action, ctx, tone);
    if (!embed) {
      return empty();
    }
    // Discord is a free channel (webhooks cost nothing), so - like email - it
    // gets the full action set. verified=true means the /discord test embed
    // landed; unverified/disabled rows never receive anything.
    const discordChannels = await this.db
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.userId, user.id),
          eq(schema.channels.type, 'discord'),
          eq(schema.channels.enabled, true),
          eq(schema.channels.verified, true)
        )
      );
    const delivered: string[] = [];
    const failed: string[] = [];
    for (const channel of discordChannels) {
      const key = `discord:${channel.id}`;
      if (alreadyDelivered.has(key)) {
        continue; // delivered on a previous attempt - don't resend
      }
      let ok = true;
      try {
        await postDiscordWebhook(channel.address, embed);
      } catch (error) {
        ok = false;
        logger.error(
          `Discord alert failed for meter ${meter.id} to ${maskWebhookUrl(channel.address)}`,
          error instanceof Error ? error.message : error
        );
      }
      await this.logDelivery({
        meterId: meter.id,
        channelId: channel.id,
        level,
        action,
        deliveryStatus: ok ? 'sent' : 'failed',
      });
      (ok ? delivered : failed).push(key);
    }
    return { delivered, failed };
  }
}
