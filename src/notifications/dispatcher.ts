import { eq, and, gte, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';
import { AlertAction, AlertLevel } from '../core/alert-machine';
import { smsPerMonthFor } from '../core/plans';
import { normalizeTone, Tone } from '../core/tone';
import { dhakaMonthStart } from '../core/quiet-hours';
import { withTimeout } from '../core/with-timeout';
import { renderAlert } from './telegram-templates';
import { MeterContext, rechargeUrl } from './alert-copy';
import { smsAlertText } from './sms-templates';
import { emailAlert } from './email-templates';
import { discordAlertEmbed } from './discord-templates';
import { sendDiscordAlert as postDiscordWebhook, DiscordEmbed } from './discord';
import { SmsGateway } from './sms';
import { WhatsAppSender } from './whatsapp';
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
 * A channel that hasn't answered in this long is treated as failed rather than
 * waited on. Without it a hung send (an SMTP socket that never closes, a webhook
 * that accepts the connection and stops) blocks the outbox worker's whole batch -
 * and because the worker skips a tick while one is in flight, the entire outbox
 * stops draining until the transport gives up on its own, which for a raw socket
 * may be never. A timeout is just a failed delivery: the row is retried.
 */
export const SEND_TIMEOUT_MS = 15_000;

/** Turn an unknown thrown value into something loggable. */
function errMsg(error: unknown): unknown {
  return error instanceof Error ? error.message : error;
}

/**
 * The enabled + verified rows of one type - the rule for every channel except
 * Telegram, which is deliberately different (see sendTelegramAlert).
 */
function deliverable(channels: schema.Channel[], type: string): schema.Channel[] {
  return channels.filter(c => c.type === type && c.enabled && c.verified);
}

/** One channel type's fan-out: what to send, to whom, and how to account for it. */
interface FanOut {
  channels: schema.Channel[];
  keyPrefix: 'email' | 'sms' | 'discord' | 'discord-dm' | 'whatsapp';
  meter: schema.Meter;
  action: AlertAction;
  level: AlertLevel;
  alreadyDelivered: ReadonlySet<string>;
  send: (channel: schema.Channel) => Promise<void>;
  onError: (channel: schema.Channel, error: unknown) => void;
  /** SMS budget: return false to stop before the next send. */
  canSend?: () => boolean;
  /** SMS budget: called after each *successful* send. */
  onSent?: () => void;
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
    private discordDm: DiscordDmSender | null = null,
    private whatsapp: WhatsAppSender | null = null
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
    // One channels query per alert, not one per channel type. If it throws, the
    // whole row fails rather than a single channel group - which is safe: the
    // worker catches that and retries the row, and since nothing was sent, the
    // delivered ledger still can't produce a duplicate.
    const channels = await this.loadChannels(user.id);
    // Channels are independent and each isolates its own errors (runChannel),
    // so send in parallel - alert latency is the slowest channel, not the sum.
    const results = await Promise.all([
      this.runChannel('telegram', () =>
        this.sendTelegramAlert(user, meter, action, level, ctx, tone, alreadyDelivered, channels)
      ),
      this.runChannel('email', () =>
        this.sendEmailAlert(meter, action, level, ctx, tone, alreadyDelivered, channels)
      ),
      this.runChannel('sms', () =>
        this.sendSmsAlert(user, meter, action, level, ctx, tone, alreadyDelivered, channels)
      ),
      this.runChannel('discord', () =>
        this.sendDiscordAlert(meter, action, level, ctx, tone, alreadyDelivered, channels)
      ),
      this.runChannel('discord-dm', () =>
        this.sendDiscordDmAlert(meter, action, level, ctx, tone, alreadyDelivered, channels)
      ),
      this.runChannel('whatsapp', () =>
        this.sendWhatsAppAlert(meter, action, level, ctx, tone, alreadyDelivered, channels)
      ),
    ]);
    return {
      delivered: results.flatMap(r => r.delivered),
      failed: results.flatMap(r => r.failed),
    };
  }

  private async loadChannels(userId: number): Promise<schema.Channel[]> {
    return this.db.select().from(schema.channels).where(eq(schema.channels.userId, userId));
  }

  // Isolate a channel so its unexpected error can't discard another channel's
  // success and cause a duplicate resend. A thrown channel is reported failed
  // under a group key so the worker retries it; nothing was delivered, so
  // there's nothing to wrongly skip next time.
  private async runChannel(
    group: string,
    fn: () => Promise<DispatchResult>
  ): Promise<DispatchResult> {
    try {
      return await fn();
    } catch (error) {
      logger.error(`${group} alert dispatch errored for a meter`, errMsg(error));
      return { delivered: [], failed: [group] };
    }
  }

  // alerts_log is the audit trail; a write failure here must not bubble up and
  // undo a successful send (which would make the worker resend it on retry).
  private async logDelivery(values: typeof schema.alertsLog.$inferInsert): Promise<void> {
    try {
      await this.db.insert(schema.alertsLog).values(values);
    } catch (error) {
      logger.error('Failed to write alerts_log row', errMsg(error));
    }
  }

  /**
   * The loop every multi-address channel shares: skip what a previous attempt
   * already delivered, send, log the attempt, collect the keys. Forgetting the
   * alreadyDelivered check in a hand-rolled copy is exactly the duplicate-send
   * bug the ledger exists to prevent - so there is only one copy of it now.
   */
  private async fanOut(o: FanOut): Promise<DispatchResult> {
    const delivered: string[] = [];
    const failed: string[] = [];
    for (const channel of o.channels) {
      const key = `${o.keyPrefix}:${channel.id}`;
      // Delivered on a previous attempt: skip it without consuming budget - that
      // send's 'sent' row is already counted in the month's usage.
      if (o.alreadyDelivered.has(key)) {
        continue;
      }
      if (o.canSend && !o.canSend()) {
        break;
      }
      let ok = true;
      try {
        await withTimeout(o.send(channel), SEND_TIMEOUT_MS, `${o.keyPrefix} send`);
      } catch (error) {
        ok = false;
        o.onError(channel, error);
      }
      await this.logDelivery({
        meterId: o.meter.id,
        channelId: channel.id,
        level: o.level,
        action: o.action,
        deliveryStatus: ok ? 'sent' : 'failed',
      });
      if (ok) {
        o.onSent?.();
        delivered.push(key);
      } else {
        failed.push(key);
      }
    }
    return { delivered, failed };
  }

  private async sendEmailAlert(
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone,
    alreadyDelivered: ReadonlySet<string>,
    channels: schema.Channel[]
  ): Promise<DispatchResult> {
    const mailer = this.mailer;
    if (!mailer) {
      return empty();
    }
    const content = emailAlert(action, ctx, tone);
    if (!content) {
      return empty();
    }
    // verified=true means the address is confirmed (web magic-link sign-in or an
    // explicit opt-in); unverified/disabled channels never receive mail.
    return this.fanOut({
      channels: deliverable(channels, 'email'),
      keyPrefix: 'email',
      meter,
      action,
      level,
      alreadyDelivered,
      send: c => mailer.send(c.address, content.subject, content.text, content.html),
      onError: (c, e) =>
        logger.error(
          `Email alert failed for meter ${meter.id} to ${maskEmail(c.address)}`,
          errMsg(e)
        ),
    });
  }

  private async sendTelegramAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone,
    alreadyDelivered: ReadonlySet<string>,
    channels: schema.Channel[]
  ): Promise<DispatchResult> {
    const message = renderAlert(action, ctx, tone);
    // Telegram rides its channel row: the chat id is the row's address, and
    // talking to the bot IS the verification (a telegram row is never `verified`
    // in the OTP sense), so respect `enabled` and ignore `verified`. Oldest row
    // wins deterministically - a merge can leave two. Deliberately NOT
    // deliverable() / fanOut: it's a single-target send with buttons, not a loop
    // over addresses.
    const tgChannel = channels
      .filter(c => c.type === 'telegram')
      .reduce<schema.Channel | undefined>(
        (oldest, c) => (!oldest || c.id < oldest.id ? c : oldest),
        undefined
      );
    if (!message || !tgChannel || !tgChannel.enabled) {
      return empty();
    }
    const key = 'telegram';
    if (alreadyDelivered.has(key)) {
      return empty(); // delivered on a previous attempt - don't resend
    }
    // Recovery is good news with nothing to act on; every other alert gets a
    // one-tap recharge link and a snooze button (snooze mutes the repeat nag).
    // Low/critical alerts also get a "check again" button to re-poll on demand.
    const firstRow: AlertButton[] = [{ text: '💳 Recharge now', url: rechargeUrl(ctx) }];
    if (action === 'low-alert' || action === 'critical-alert') {
      firstRow.push({ text: '🔄 Check again', callbackData: `recheck:${meter.id}` });
    }
    const buttons: AlertButton[][] | undefined =
      action === 'recovery'
        ? undefined
        : [firstRow, [{ text: '🔕 Snooze 3 days', callbackData: `snooze:${meter.id}` }]];
    let ok = true;
    try {
      await withTimeout(
        this.telegram.sendTelegram(Number(tgChannel.address), message, buttons),
        SEND_TIMEOUT_MS,
        'telegram send'
      );
    } catch (error) {
      ok = false;
      logger.error(`Telegram alert failed for meter ${meter.id}`, errMsg(error));
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
    alreadyDelivered: ReadonlySet<string>,
    channels: schema.Channel[]
  ): Promise<DispatchResult> {
    const gateway = this.sms;
    if (!gateway) {
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
    // unverified channels never receive a message.
    const smsChannels = deliverable(channels, 'sms');
    if (smsChannels.length === 0) {
      return empty();
    }

    const usedThisMonth = await this.smsSentThisMonth(smsChannels.map(c => c.id));
    if (usedThisMonth >= budget) {
      logger.warn(`User ${user.id} hit the monthly SMS budget (${budget}), skipping SMS`);
      return empty();
    }

    // The budget is the hard cap on billable segments. Decrement per successful
    // send so a user with several verified numbers can't overshoot it in a single
    // fan-out (failed sends don't burn budget, matching usedThisMonth). This stays
    // out here rather than inside fanOut - SMS is the only channel that costs money.
    let remaining = budget - usedThisMonth;
    return this.fanOut({
      channels: smsChannels,
      keyPrefix: 'sms',
      meter,
      action,
      level,
      alreadyDelivered,
      canSend: () => {
        if (remaining > 0) {
          return true;
        }
        logger.warn(`User ${user.id} reached the SMS budget (${budget}) mid-alert, stopping`);
        return false;
      },
      onSent: () => {
        remaining--;
      },
      send: c => gateway.send(c.address, text),
      onError: (c, e) =>
        logger.error(
          `SMS alert failed for meter ${meter.id} via ${gateway.name} to ${maskPhone(c.address)}`,
          errMsg(e)
        ),
    });
  }

  /** Billable segments already sent this calendar month across the user's numbers. */
  private async smsSentThisMonth(channelIds: number[]): Promise<number> {
    // the budget month rolls at midnight Dhaka, not server-local midnight
    const monthStart = dhakaMonthStart(new Date());
    return this.db.$count(
      schema.alertsLog,
      and(
        inArray(schema.alertsLog.channelId, channelIds),
        gte(schema.alertsLog.sentAt, monthStart),
        eq(schema.alertsLog.deliveryStatus, 'sent')
      )
    );
  }

  // The Discord *bot* channel. Same idea as the webhook channel - free, full
  // action set - but delivery is a DM through the bot instead of a webhook post.
  // The 'discord-dm' row is created verified at registration (running a slash
  // command proves the user controls that snowflake). The DM itself can still
  // fail (closed DMs, bot blocked); that's a failed delivery and the outbox
  // retries it.
  private async sendWhatsAppAlert(
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone,
    alreadyDelivered: ReadonlySet<string>,
    channels: schema.Channel[]
  ): Promise<DispatchResult> {
    const sender = this.whatsapp;
    if (!sender) {
      return empty();
    }
    const message = renderAlert(action, ctx, tone);
    if (!message) {
      return empty();
    }
    // WhatsApp is a free-ish channel like Discord, so it gets the full action set.
    // verified rows are numbers proven via the connect webhook.
    return this.fanOut({
      channels: deliverable(channels, 'whatsapp'),
      keyPrefix: 'whatsapp',
      meter,
      action,
      level,
      alreadyDelivered,
      send: c => sender.send(c.address, message),
      onError: (c, e) =>
        logger.error(
          `WhatsApp alert failed for meter ${meter.id} to ${maskPhone(c.address)}`,
          errMsg(e)
        ),
    });
  }

  private async sendDiscordDmAlert(
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone,
    alreadyDelivered: ReadonlySet<string>,
    channels: schema.Channel[]
  ): Promise<DispatchResult> {
    const dm = this.discordDm;
    if (!dm) {
      return empty();
    }
    const embed = discordAlertEmbed(action, ctx, tone);
    if (!embed) {
      return empty();
    }
    return this.fanOut({
      channels: deliverable(channels, 'discord-dm'),
      keyPrefix: 'discord-dm',
      meter,
      action,
      level,
      alreadyDelivered,
      send: c => dm.sendDm(c.address, embed),
      onError: (_c, e) => logger.error(`Discord DM alert failed for meter ${meter.id}`, errMsg(e)),
    });
  }

  private async sendDiscordAlert(
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone,
    alreadyDelivered: ReadonlySet<string>,
    channels: schema.Channel[]
  ): Promise<DispatchResult> {
    const embed = discordAlertEmbed(action, ctx, tone);
    if (!embed) {
      return empty();
    }
    // Discord is a free channel (webhooks cost nothing), so - like email - it gets
    // the full action set. verified=true means the /discord test embed landed;
    // unverified/disabled rows never receive anything.
    return this.fanOut({
      channels: deliverable(channels, 'discord'),
      keyPrefix: 'discord',
      meter,
      action,
      level,
      alreadyDelivered,
      send: c => postDiscordWebhook(c.address, embed),
      onError: (c, e) =>
        logger.error(
          `Discord alert failed for meter ${meter.id} to ${maskWebhookUrl(c.address)}`,
          errMsg(e)
        ),
    });
  }
}
