import { eq, and, gte, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';
import { AlertAction, AlertLevel } from '../core/alert-machine';
import { smsPerMonthFor } from '../core/plans';
import { renderAlert, MeterContext } from './telegram-templates';
import { smsAlertText } from './sms-templates';
import { SmsGateway } from './sms';

export interface TelegramSender {
  sendTelegram(chatId: number, text: string): Promise<void>;
}

/**
 * Fans an alert out to every channel the user has: Telegram always (free),
 * SMS only for low/critical alerts, only on plans with an SMS budget, and
 * only while this month's budget holds. Every delivery attempt is logged
 * to alerts_log with its channel and status.
 */
export class Dispatcher {
  constructor(
    private db: Db,
    private telegram: TelegramSender,
    private sms: SmsGateway | null
  ) {}

  async dispatchAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext
  ): Promise<void> {
    await this.sendTelegramAlert(user, meter, action, level, ctx);
    await this.sendSmsAlert(user, meter, action, level, ctx);
  }

  private async sendTelegramAlert(
    user: schema.User,
    meter: schema.Meter,
    action: AlertAction,
    level: AlertLevel,
    ctx: MeterContext
  ): Promise<void> {
    const message = renderAlert(action, ctx);
    if (!message || user.telegramChatId === null) {
      return;
    }
    let deliveryStatus = 'sent';
    try {
      await this.telegram.sendTelegram(user.telegramChatId, message);
    } catch (error) {
      deliveryStatus = 'failed';
      console.error(`Telegram alert failed for meter ${meter.id}:`, error);
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
    ctx: MeterContext
  ): Promise<void> {
    if (!this.sms) {
      return;
    }
    const text = smsAlertText(action, ctx);
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
      console.warn(`User ${user.id} hit the monthly SMS budget (${budget}), skipping SMS`);
      return;
    }

    for (const channel of smsChannels) {
      let deliveryStatus = 'sent';
      try {
        await this.sms.send(channel.address, text);
      } catch (error) {
        deliveryStatus = 'failed';
        console.error(`SMS alert failed for meter ${meter.id} via ${this.sms.name}:`, error);
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
