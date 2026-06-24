// drains the pending_alerts outbox. the scheduler writes a row in the same
// transaction as alert_state, so a crash between "decide to alert" and
// "actually alert" can't lose or duplicate the message - the row just sits
// pending until we get to it. we flip to 'sent' only after the dispatcher
// confirms delivery; failed sends back off and after MAX_ATTEMPTS the row is
// marked 'failed' and the operator gets pinged.

import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { Db, schema } from '../db';
import { Dispatcher, TelegramSender } from '../notifications/dispatcher';
import { MeterContext } from '../notifications/telegram-templates';
import { logger } from '../logger';

const POLL_INTERVAL_MS = 5_000;
// cap rows pulled per cycle so a long backlog can't starve new alerts.
const BATCH_SIZE = 20;
// after this many tries the row is poisoned and an admin gets pinged.
const MAX_ATTEMPTS = 5;
// base delay (ms) for backoff: 30s, 1m, 2m, 4m, 8m, ...
const BACKOFF_BASE_MS = 30_000;

export interface AlertDispatcherDeps {
  db: Db;
  dispatcher: Dispatcher;
  /** optional: send a heads-up to the operator when a row exhausts retries. */
  adminSender?: TelegramSender | null;
  adminChatId?: number | null;
}

export class AlertDispatcherWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inflight = false;

  constructor(private deps: AlertDispatcherDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    // tick once up front so a fresh restart doesn't sit on the interval.
    void this.tick();
    logger.info(`Alert dispatcher worker started (poll ${POLL_INTERVAL_MS}ms)`);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // wait for any in-flight batch to finish so we don't leave a row half-done.
    while (this.inflight) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /** process one batch. exposed for tests. */
  async tick(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    try {
      await this.drainBatch();
    } catch (error) {
      logger.error('Alert dispatcher tick failed', error);
    } finally {
      this.inflight = false;
    }
  }

  private async drainBatch(): Promise<void> {
    // SKIP LOCKED so two workers (or two replicas) can drain in parallel
    // without blocking on each other.
    const ready = await this.deps.db
      .select()
      .from(schema.pendingAlerts)
      .where(
        and(
          eq(schema.pendingAlerts.status, 'pending'),
          lte(schema.pendingAlerts.nextAttempt, sql`now()`)
        )
      )
      .orderBy(asc(schema.pendingAlerts.nextAttempt))
      .limit(BATCH_SIZE)
      .for('update', { skipLocked: true });

    if (ready.length === 0) return;
    logger.info(`Draining ${ready.length} pending alert(s)`);

    for (const row of ready) {
      try {
        await this.processRow(row);
      } catch (error) {
        // processRow already records the error on the row; this is a
        // belt-and-braces catch so a single bad row can't kill the loop.
        logger.error(`Failed to process pending alert ${row.id}`, error);
      }
    }
  }

  private async processRow(row: schema.PendingAlert): Promise<void> {
    let ctx: MeterContext;
    try {
      ctx = JSON.parse(row.payload) as MeterContext;
    } catch (error) {
      // malformed (shouldn't happen - scheduler writes it). don't retry
      // forever; mark failed.
      logger.error(`Pending alert ${row.id} has invalid payload`, error);
      await this.deps.db
        .update(schema.pendingAlerts)
        .set({
          status: 'failed',
          lastError: `invalid payload: ${error instanceof Error ? error.message : 'parse error'}`,
        })
        .where(eq(schema.pendingAlerts.id, row.id));
      return;
    }

    // re-fetch user + meter at send time so channel state (verified, enabled)
    // reflects the latest, not a stale snapshot.
    const [user] = await this.deps.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, row.userId));
    const [meter] = await this.deps.db
      .select()
      .from(schema.meters)
      .where(eq(schema.meters.id, row.meterId));

    if (!user || !meter) {
      // user was deleted between schedule and dispatch. drop the row.
      logger.warn(`Pending alert ${row.id} references deleted user/meter; dropping`);
      await this.deps.db
        .update(schema.pendingAlerts)
        .set({ status: 'failed', lastError: 'user or meter deleted' })
        .where(eq(schema.pendingAlerts.id, row.id));
      return;
    }

    // dispatchAlert's per-channel try/catches absorb real failures and log
    // them; a throw here is unexpected, so treat it as a retryable transient.
    try {
      await this.deps.dispatcher.dispatchAlert(
        user,
        meter,
        // DB stores action/level as text, dispatcher takes the same union
        // types. cast through unknown to skip a runtime validator - scheduler
        // is the only writer and uses these literals.
        row.action as never,
        row.level as never,
        ctx
      );
      await this.deps.db
        .update(schema.pendingAlerts)
        .set({ status: 'sent', deliveredAt: new Date(), lastError: null })
        .where(eq(schema.pendingAlerts.id, row.id));
      logger.info(`Pending alert ${row.id} delivered`);
    } catch (error) {
      const attempts = row.attempts + 1;
      const lastError = error instanceof Error ? error.message : String(error);
      if (attempts >= MAX_ATTEMPTS) {
        await this.deps.db
          .update(schema.pendingAlerts)
          .set({ status: 'failed', attempts, lastError })
          .where(eq(schema.pendingAlerts.id, row.id));
        logger.error(
          `Pending alert ${row.id} exhausted retries (${attempts}); marked failed`,
          lastError
        );
        if (
          this.deps.adminSender &&
          this.deps.adminChatId !== null &&
          this.deps.adminChatId !== undefined
        ) {
          try {
            await this.deps.adminSender.sendTelegram(
              this.deps.adminChatId,
              `🚨 Alert for meter ${meter.id} (${meter.accountNo}/${meter.meterNo}) failed after ${attempts} attempts. Last error: ${lastError}`
            );
          } catch (notifyError) {
            logger.error('Failed to notify admin of dead-letter alert', notifyError);
          }
        }
      } else {
        const backoffMs = BACKOFF_BASE_MS * 2 ** (attempts - 1);
        await this.deps.db
          .update(schema.pendingAlerts)
          .set({
            attempts,
            nextAttempt: new Date(Date.now() + backoffMs),
            lastError,
          })
          .where(eq(schema.pendingAlerts.id, row.id));
        logger.warn(
          `Pending alert ${row.id} attempt ${attempts} failed; retrying in ${backoffMs}ms`,
          lastError
        );
      }
    }
  }
}
