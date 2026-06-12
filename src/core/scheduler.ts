import { eq } from 'drizzle-orm';
import { Db, schema } from '../db';
import { evaluate, AlertStateSnapshot, AlertLevel } from './alert-machine';
import { getProvider } from '../providers';
import { renderAlert, MeterContext } from '../notifications/telegram-templates';
import { ServerConfig } from '../config';

export interface AlertSender {
  sendTelegram(chatId: number, text: string): Promise<void>;
}

const MAX_FETCH_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 2000;
// above this failure ratio (with enough meters to be meaningful), assume the
// desco api changed or we got blocked, and alert the operator.
const ERROR_RATE_ALARM = 0.5;
const ERROR_RATE_MIN_SAMPLE = 5;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** when the last full poll cycle finished null until the first completes. */
  lastCycleCompletedAt: Date | null = null;

  constructor(
    private db: Db,
    private sender: AlertSender,
    private config: ServerConfig
  ) {}

  start(): void {
    const intervalMs = this.config.pollIntervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
    void this.runOnce();
    console.log(`Scheduler started: polling every ${this.config.pollIntervalHours}h`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      console.warn('Previous poll cycle still running, skipping');
      return;
    }
    this.running = true;
    const startedAt = Date.now();
    let ok = 0;
    let failed = 0;

    try {
      const rows = await this.db
        .select({ meter: schema.meters, user: schema.users })
        .from(schema.meters)
        .innerJoin(schema.users, eq(schema.meters.userId, schema.users.id))
        .where(eq(schema.meters.active, true));

      console.log(`Poll cycle: checking ${rows.length} meter(s)`);

      for (const { meter, user } of rows) {
        try {
          await this.checkMeter(meter, user);
          ok++;
        } catch (error) {
          failed++;
          console.error(
            `Meter ${meter.id} (${meter.provider}/${meter.meterNo}) check failed:`,
            error instanceof Error ? error.message : error
          );
        }
        // jitter between requests so we never hammer the provider
        await sleep(500 + Math.random() * this.config.jitterMaxMs);
      }

      const total = ok + failed;
      if (total >= ERROR_RATE_MIN_SAMPLE && failed / total > ERROR_RATE_ALARM) {
        await this.alarmOperator(
          `🚨 Poll cycle error rate ${failed}/${total}. The provider API may have changed or blocked us.`
        );
      }

      console.log(
        `Poll cycle done in ${Math.round((Date.now() - startedAt) / 1000)}s: ${ok} ok, ${failed} failed`
      );
      this.lastCycleCompletedAt = new Date();
    } finally {
      this.running = false;
    }
  }

  private async checkMeter(meter: schema.Meter, user: schema.User): Promise<void> {
    const provider = getProvider(meter.provider);
    const identity = { accountNo: meter.accountNo, meterNo: meter.meterNo };

    let lastError: unknown;
    let balanceData = null;
    let attempt = 1;
    while (attempt <= MAX_FETCH_ATTEMPTS) {
      try {
        balanceData = await provider.getBalance(identity);
        break;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_FETCH_ATTEMPTS) {
          const backoff = BACKOFF_BASE_MS * 4 ** (attempt - 1) * (0.5 + Math.random());
          await sleep(backoff);
        }
      }
      attempt++;
    }
    if (!balanceData) {
      throw lastError;
    }

    const balance = balanceData.balance;

    await this.db.insert(schema.readings).values({
      meterId: meter.id,
      balance,
      currentMonthConsumption: balanceData.currentMonthConsumption ?? null,
      readingTime: balanceData.readingTime ?? null,
    });

    const [stateRow] = await this.db
      .select()
      .from(schema.alertState)
      .where(eq(schema.alertState.meterId, meter.id));

    const prev: AlertStateSnapshot = {
      level: (stateRow?.level ?? 'ok') as AlertLevel,
      lastAlertAt: stateRow?.lastAlertAt ?? null,
      lastBalance: stateRow?.lastBalance ?? null,
    };

    const now = new Date();
    const decision = evaluate(
      prev,
      balance,
      { low: meter.lowThreshold, critical: meter.criticalThreshold },
      now,
      this.config.reminderIntervalHours * 60 * 60 * 1000
    );

    const alertSent = decision.action !== 'none';
    const stateUpdate = {
      level: decision.level,
      lastBalance: balance,
      lastAlertAt: alertSent ? now : (stateRow?.lastAlertAt ?? null),
      rechargeDetectedAt: decision.rechargeDetected ? now : (stateRow?.rechargeDetectedAt ?? null),
      updatedAt: now,
    };
    await this.db
      .insert(schema.alertState)
      .values({ meterId: meter.id, ...stateUpdate })
      .onConflictDoUpdate({ target: schema.alertState.meterId, set: stateUpdate });

    if (!alertSent) {
      return;
    }

    const ctx: MeterContext = {
      nickname: meter.nickname,
      accountNo: meter.accountNo,
      meterNo: meter.meterNo,
      balance,
      lowThreshold: meter.lowThreshold,
      criticalThreshold: meter.criticalThreshold,
    };
    const message = renderAlert(decision.action, ctx);
    if (!message || user.telegramChatId === null) {
      return;
    }

    let deliveryStatus = 'sent';
    try {
      await this.sender.sendTelegram(user.telegramChatId, message);
    } catch (error) {
      deliveryStatus = 'failed';
      console.error(`Failed to deliver alert for meter ${meter.id}:`, error);
    }

    await this.db.insert(schema.alertsLog).values({
      meterId: meter.id,
      level: decision.level,
      action: decision.action,
      deliveryStatus,
    });
  }

  private async alarmOperator(text: string): Promise<void> {
    console.error(text);
    if (this.config.adminChatId !== null) {
      try {
        await this.sender.sendTelegram(this.config.adminChatId, text);
      } catch (error) {
        console.error('Failed to notify admin:', error);
      }
    }
  }
}
