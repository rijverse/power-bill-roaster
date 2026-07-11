import { eq, and, gte, lte, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { Db, schema } from '../db';
import { evaluate, AlertStateSnapshot, AlertLevel } from './alert-machine';
import { recentPrediction } from './meter-usecases';
import { getProvider } from '../providers';
import { MeterContext } from '../notifications/alert-copy';
import { TelegramSender, DiscordDmSender } from '../notifications/dispatcher';
import { SubscriptionService } from '../billing';
import { ServerConfig } from '../config';
import { adminDeepLink } from './admin-link';
import { notifyOperator } from './operator-notify';
import { logger } from '../logger';

export type AlertSender = TelegramSender;

const MAX_FETCH_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 2000;
// above this failure ratio (with enough meters to be meaningful), assume the
// desco api changed or we got blocked, and alert the operator.
const ERROR_RATE_ALARM = 0.5;
const ERROR_RATE_MIN_SAMPLE = 5;
// arbitrary app-wide constant identifying "the poll cycle" advisory lock;
// guarantees only one instance polls even if two processes share the DB
const POLL_LOCK_KEY = 727274001;
// the outbox worker polls every 5s, so a DUE row (next_attempt in the past)
// still pending after 2min means the worker is wedged. Rows waiting out a
// retry backoff or quiet-hours hold have next_attempt in the future and are
// healthy - they must not page the operator. 24h on failed rows surfaces
// "today's dead letters" so the operator notices.
const STUCK_PENDING_THRESHOLD_MS = 2 * 60 * 1000;
const RECENT_FAILED_WINDOW_MS = 24 * 60 * 60 * 1000;
// after this many consecutive failed reads of one meter, tell the user once
// (their meter may be deactivated or renumbered) instead of going silent.
const FAILURE_NOTIFY_THRESHOLD = 3;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Where the one-time "meter unreadable" notice should go: Telegram when the
 * account has a chat id, else a Discord DM when the account is Discord-linked
 * and the Discord bot is running, else nowhere. Exported for tests.
 */
export function failureNoticeTarget(
  user: Pick<schema.User, 'telegramChatId' | 'discordUserId'>,
  discordAvailable: boolean
): { kind: 'telegram'; chatId: number } | { kind: 'discord'; discordUserId: string } | null {
  if (user.telegramChatId !== null) {
    return { kind: 'telegram', chatId: user.telegramChatId };
  }
  if (discordAvailable && user.discordUserId !== null) {
    return { kind: 'discord', discordUserId: user.discordUserId };
  }
  return null;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** when the last full poll cycle finished null until the first completes. */
  lastCycleCompletedAt: Date | null = null;

  /** true while a poll cycle is in flight (the operator "run now" button checks this). */
  get isPolling(): boolean {
    return this.running;
  }

  constructor(
    private db: Db,
    private pool: Pool,
    private sender: AlertSender,
    private config: ServerConfig,
    private subscriptions: SubscriptionService,
    // Fallback for the "meter unreadable" notice when a user has no Telegram
    // identity (Discord-only accounts). Null when the Discord bot is off.
    private discordDm: DiscordDmSender | null = null
  ) {}

  start(): void {
    const intervalMs = this.config.pollIntervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
    void this.runOnce();
    logger.info(`Scheduler started: polling every ${this.config.pollIntervalHours}h`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      logger.warn('Previous poll cycle still running, skipping');
      return;
    }
    this.running = true;
    // advisory locks are session-scoped: acquire and release must happen on
    // the same connection, so hold one pooled client for the whole cycle
    const lockClient = await this.pool.connect();
    let locked = false;
    const startedAt = Date.now();
    let ok = 0;
    let failed = 0;

    try {
      const lockResult = await lockClient.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [POLL_LOCK_KEY]
      );
      locked = lockResult.rows[0]?.locked === true;
      if (!locked) {
        logger.warn('Another instance holds the poll lock, skipping this cycle');
        return;
      }

      // lapsed subscriptions downgrade before alerts go out, so SMS budgets
      // and meter caps reflect the plan the user is actually paying for
      try {
        await this.subscriptions.expireOverdue();
      } catch (error) {
        logger.error('Subscription expiry sweep failed', error);
      }

      // alert_state rides along on the join instead of a SELECT per meter. Safe
      // because we hold the poll lock: every column here except
      // remindersSnoozedUntil is written only by this cycle, so the row we read
      // at the start is still authoritative when we get to that meter. Snooze is
      // the exception and checkMeter re-reads it - see there.
      const rows = await this.db
        .select({ meter: schema.meters, user: schema.users, state: schema.alertState })
        .from(schema.meters)
        .innerJoin(schema.users, eq(schema.meters.userId, schema.users.id))
        .leftJoin(schema.alertState, eq(schema.alertState.meterId, schema.meters.id))
        .where(eq(schema.meters.active, true));

      logger.info(`Poll cycle: checking ${rows.length} meter(s)`);

      for (const { meter, user, state } of rows) {
        try {
          await this.checkMeter(meter, user, state);
          ok++;
        } catch (error) {
          failed++;
          logger.error(
            `Meter ${meter.id} (${meter.provider}/${meter.meterNo}) check failed`,
            error instanceof Error ? error.message : error
          );
          await this.recordMeterFailure(meter, user, state).catch(e =>
            logger.error(`Failed to record meter ${meter.id} read failure`, e)
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

      // Outbox backlog check: catches a wedged dispatcher worker (rows stuck
      // pending) and surfaces "today's dead letters" (rows that exhausted
      // retries) - both would otherwise only be visible via a user complaint.
      // The check itself is cheap; the alarm goes through the same operator
      // channel as the error-rate alarm above.
      try {
        const [stuck] = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.pendingAlerts)
          .where(
            and(
              eq(schema.pendingAlerts.status, 'pending'),
              lte(
                schema.pendingAlerts.nextAttempt,
                new Date(Date.now() - STUCK_PENDING_THRESHOLD_MS)
              )
            )
          );
        if (stuck && stuck.count > 0) {
          await this.alarmOperator(
            `🚨 Outbox worker appears wedged: ${stuck.count} alert(s) due for over 2 min and still pending. The dispatcher should be draining these in seconds.`,
            'logs/failed'
          );
        }
        const [failed] = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.pendingAlerts)
          .where(
            and(
              eq(schema.pendingAlerts.status, 'failed'),
              gte(schema.pendingAlerts.createdAt, new Date(Date.now() - RECENT_FAILED_WINDOW_MS))
            )
          );
        if (failed && failed.count > 0) {
          await this.alarmOperator(
            `🚨 ${failed.count} alert(s) exhausted retries in the last 24h. Check pending_alerts and the channel health (SMS gateway, mailer, Telegram).`,
            'logs/failed'
          );
        }
      } catch (error) {
        logger.error('Outbox backlog check failed', error);
      }

      logger.info(
        `Poll cycle done in ${Math.round((Date.now() - startedAt) / 1000)}s: ${ok} ok, ${failed} failed`
      );
      this.lastCycleCompletedAt = new Date();
    } catch (error) {
      // runOnce is fired via `void`, so without this the rejection would only
      // surface in the unhandledRejection log. lastCycleCompletedAt stays
      // stale on purpose - the watchdog restarts us if this keeps happening.
      logger.error('Poll cycle failed', error);
    } finally {
      if (locked) {
        try {
          await lockClient.query('SELECT pg_advisory_unlock($1)', [POLL_LOCK_KEY]);
        } catch (error) {
          logger.error('Failed to release poll lock', error);
        }
      }
      lockClient.release();
      this.running = false;
    }
  }

  private async checkMeter(
    meter: schema.Meter,
    user: schema.User,
    joinedState: schema.AlertStateRow | null
  ): Promise<void> {
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

    // The joined row is authoritative for everything the poll cycle owns. The one
    // column another process can change underneath us is remindersSnoozedUntil -
    // the snooze button writes it, possibly while this very cycle is running - and
    // it gates only the reminder branch, which can only be reached from a non-ok
    // level. So re-read for a meter that's already in alert, and take the free ride
    // for the healthy majority.
    const stateRow =
      joinedState && joinedState.level !== 'ok'
        ? ((
            await this.db
              .select()
              .from(schema.alertState)
              .where(eq(schema.alertState.meterId, meter.id))
          )[0] ?? joinedState)
        : joinedState;

    const prev: AlertStateSnapshot = {
      level: (stateRow?.level ?? 'ok') as AlertLevel,
      lastAlertAt: stateRow?.lastAlertAt ?? null,
      lastBalance: stateRow?.lastBalance ?? null,
      remindersSnoozedUntil: stateRow?.remindersSnoozedUntil ?? null,
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
      // a successful read clears any "can't reach this meter" state
      consecutiveFailures: 0,
      failureNotifiedAt: null,
      // an alert that actually fires ends an active snooze; a reminder
      // suppressed by snooze (action 'none') keeps it so it still holds
      remindersSnoozedUntil: alertSent ? null : (stateRow?.remindersSnoozedUntil ?? null),
      updatedAt: now,
    };

    if (!alertSent) {
      // no alert to send - just refresh the level/balance snapshot, no
      // transaction needed because nothing fans out from here.
      await this.db
        .insert(schema.alertState)
        .values({ meterId: meter.id, ...stateUpdate })
        .onConflictDoUpdate({ target: schema.alertState.meterId, set: stateUpdate });
      return;
    }

    // wrap alert_state + pending_alerts in one transaction so a crash between
    // them can't leave lastAlertAt advanced but no row queued (silencing the
    // user) or vice versa (sending the same alert twice).
    const ctx: MeterContext = {
      nickname: meter.nickname,
      accountNo: meter.accountNo,
      meterNo: meter.meterNo,
      balance,
      lowThreshold: meter.lowThreshold,
      criticalThreshold: meter.criticalThreshold,
      prediction: await recentPrediction(this.db, meter.id, balance, now),
      rechargeUrl: this.config.rechargeUrl,
    };

    await this.db.transaction(async tx => {
      await tx
        .insert(schema.alertState)
        .values({ meterId: meter.id, ...stateUpdate })
        .onConflictDoUpdate({ target: schema.alertState.meterId, set: stateUpdate });
      await tx.insert(schema.pendingAlerts).values({
        meterId: meter.id,
        userId: user.id,
        action: decision.action,
        level: decision.level,
        payload: JSON.stringify(ctx),
      });
    });
  }

  // bumps a meter's consecutive-failure count and, once it crosses the threshold,
  // pings the user once that we can't read their meter - otherwise a deactivated
  // or renumbered meter would just go quiet. Telegram when linked, else a Discord
  // DM (Discord-only accounts must hear this too). a good read resets the count
  // (see checkMeter's stateUpdate).
  // The joined alert_state row is enough here: consecutiveFailures and
  // failureNotifiedAt are written only by the poll cycle, and we hold its lock.
  private async recordMeterFailure(
    meter: schema.Meter,
    user: schema.User,
    stateRow: schema.AlertStateRow | null
  ): Promise<void> {
    const target = failureNoticeTarget(user, this.discordDm !== null);
    const consecutiveFailures = (stateRow?.consecutiveFailures ?? 0) + 1;
    const alreadyNotified = stateRow?.failureNotifiedAt != null;
    const shouldNotify =
      consecutiveFailures >= FAILURE_NOTIFY_THRESHOLD && !alreadyNotified && target !== null;
    const now = new Date();
    const set = {
      consecutiveFailures,
      failureNotifiedAt: shouldNotify ? now : (stateRow?.failureNotifiedAt ?? null),
      updatedAt: now,
    };
    await this.db
      .insert(schema.alertState)
      .values({ meterId: meter.id, ...set })
      .onConflictDoUpdate({ target: schema.alertState.meterId, set });

    if (!shouldNotify || target === null) {
      return;
    }
    const label = meter.nickname ?? `meter ${meter.meterNo}`;
    const body = [
      "DESCO's service may be down, or the account/meter numbers may have changed (a replaced meter gets new numbers). Balance alerts for it are paused until I can read it again.",
      'If the meter changed, use /stop and then /register the new one.',
    ].join('\n');
    if (target.kind === 'telegram') {
      await this.sender.sendTelegram(
        target.chatId,
        `⚠️ I haven't been able to read ${label} for a while.\n\n${body}`
      );
    } else if (this.discordDm) {
      await this.discordDm.sendDm(target.discordUserId, {
        title: `⚠️ I haven't been able to read ${label} for a while`,
        description: body,
        color: 0xf59e0b,
      });
    }
  }

  private async alarmOperator(text: string, hash?: string): Promise<void> {
    // A deep link straight to the relevant panel screen turns an alarm into a
    // one-tap investigation. Skipped when we only have the localhost default.
    const link = hash ? adminDeepLink(this.config.publicBaseUrl, hash) : '';
    const message = link ? `${text}\n${link}` : text;
    logger.error(message);
    await notifyOperator(
      {
        telegram:
          this.config.adminChatId !== null
            ? { sender: this.sender, chatId: this.config.adminChatId }
            : null,
        discord:
          this.discordDm && this.config.adminDiscordUserId !== null
            ? { dm: this.discordDm, userId: this.config.adminDiscordUserId }
            : null,
      },
      '🚨 Operator alarm',
      message
    );
  }
}
