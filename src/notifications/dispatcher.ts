import { eq, and, gte, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';
import { AlertAction, AlertLevel } from '../core/alert-machine';
import { smsPerMonthFor } from '../core/plans';
import { normalizeTone, Tone } from '../core/tone';
import { inQuietHours } from '../core/quiet-hours';
import { renderAlert, MeterContext } from './telegram-templates';
import { smsAlertText } from './sms-templates';
import { emailAlert } from './email-templates';
import { SmsGateway } from './sms';
import { Mailer } from '../services/mailer';
import { logger, maskEmail, maskPhone } from '../logger';

export interface TelegramSender {
  sendTelegram(chatId: number, text: string): Promise<void>;
}

/**
 * Fans an alert out to every channel the user has: Telegram always (free),
 * email to verified addresses (free, so reminders/recovery go too), and SMS
 * only for low/critical, only on plans with an SMS budget, and only while this
 * month's budget holds. Every delivery attempt is logged to alerts_log.
 */
export class Dispatcher {
  constructor(
    private db: Db,
    private telegram: TelegramSender,
    private sms: SmsGateway | null,
    private mailer: Mailer | null = null
  ) {}

  async dispatchAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext
  ): Promise<void> {
    // Quiet hours hold back the nags (low / reminder / recovery), but a critical
    // alert - power about to be cut - always goes through.
    if (action !== 'critical-alert' && inQuietHours(new Date(), user.quietStart, user.quietEnd)) {
      return;
    }
    const tone = normalizeTone(user.tonePref);
    await this.sendTelegramAlert(user, meter, action, level, ctx, tone);
    await this.sendEmailAlert(user, meter, action, level, ctx, tone);
    await this.sendSmsAlert(user, meter, action, level, ctx, tone);
  }

  private async sendEmailAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone
  ): Promise<void> {
    if (!this.mailer) {
      return;
    }
    const content = emailAlert(action, ctx, tone);
    if (!content) {
      return;
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
    for (const channel of emailChannels) {
      let deliveryStatus = 'sent';
      try {
        await this.mailer.send(channel.address, content.subject, content.text, content.html);
      } catch (error) {
        deliveryStatus = 'failed';
        logger.error(
          `Email alert failed for meter ${meter.id} to ${maskEmail(channel.address)}`,
          error instanceof Error ? error.message : error
        );
      }
      await this.db.insert(schema.alertsLog).values({
        meterId: meter.id,
        channelId: channel.id,
        level,
        action,
        deliveryStatus,
      });
    }
  }

  private async sendTelegramAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone
  ): Promise<void> {
    const message = renderAlert(action, ctx, tone);
    if (!message || user.telegramChatId === null) {
      return;
    }
    // Telegram has no per-address row by default (it rides user.telegramChatId);
    // a 'telegram' channel row exists only once the user toggles it. Respect it.
    const [tgChannel] = await this.db
      .select()
      .from(schema.channels)
      .where(and(eq(schema.channels.userId, user.id), eq(schema.channels.type, 'telegram')));
    if (tgChannel && !tgChannel.enabled) {
      return;
    }
    let deliveryStatus = 'sent';
    try {
      await this.telegram.sendTelegram(user.telegramChatId, message);
    } catch (error) {
      deliveryStatus = 'failed';
      logger.error(
        `Telegram alert failed for meter ${meter.id}`,
        error instanceof Error ? error.message : error
      );
    }
    await this.db.insert(schema.alertsLog).values({
      meterId: meter.id,
      level,
      action,
      deliveryStatus,
    });
  }

  private async sendSmsAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext,
    tone: Tone
  ): Promise<void> {
    if (!this.sms) {
      return;
    }
    const text = smsAlertText(action, ctx, tone);
    if (!text) {
      return; // reminders/recovery don't burn paid segments
    }
    const budget = smsPerMonthFor(user.plan);
    if (budget === 0) {
      return;
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
      return;
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
      return;
    }

    // The budget is the hard cap on billable segments. Decrement per successful
    // send so a user with several verified numbers can't overshoot it in a
    // single fan-out (failed sends don't burn budget, matching usedThisMonth).
    let remaining = budget - usedThisMonth;
    for (const channel of smsChannels) {
      if (remaining <= 0) {
        logger.warn(`User ${user.id} reached the SMS budget (${budget}) mid-alert, stopping`);
        break;
      }
      let deliveryStatus = 'sent';
      try {
        await this.sms.send(channel.address, text);
        remaining--;
      } catch (error) {
        deliveryStatus = 'failed';
        logger.error(
          `SMS alert failed for meter ${meter.id} via ${this.sms.name} to ${maskPhone(channel.address)}`,
          error instanceof Error ? error.message : error
        );
      }
      await this.db.insert(schema.alertsLog).values({
        meterId: meter.id,
        channelId: channel.id,
        level,
        action,
        deliveryStatus,
      });
    }
  }
}
