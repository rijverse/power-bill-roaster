// drains the pending_alerts outbox. the scheduler writes a row in the same
// transaction as alert_state, so a crash between "decide to alert" and
// "actually alert" can't lose or duplicate the message - the row just sits
// pending until we get to it. we flip to 'sent' only after the dispatcher
// confirms delivery; failed sends back off and after MAX_ATTEMPTS the row is
// marked 'failed' and the operator gets pinged.

import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { Db, schema } from '../db';
import {
  Dispatcher,
  DispatchResult,
  TelegramSender,
  DiscordDmSender,
} from '../notifications/dispatcher';
import { inQuietHours, quietHoursEnd } from './quiet-hours';
import { withTimeout } from './with-timeout';
import { MeterContext } from '../notifications/alert-copy';
import { notifyOperator } from './operator-notify';
import { logger } from '../logger';

const POLL_INTERVAL_MS = 5_000;
// cap rows pulled per cycle so a long backlog can't starve new alerts.
const BATCH_SIZE = 10;
// after this many tries the row is poisoned and an admin gets pinged.
const MAX_ATTEMPTS = 5;
// base delay (ms) for backoff: 30s, 1m, 2m, 4m, 8m, ...
const BACKOFF_BASE_MS = 30_000;
// A row's channels fan out in parallel and each send is capped at SEND_TIMEOUT_MS,
// so a row can't legitimately take much longer than that. The cap makes the worker
// unwedgeable: a row that somehow hangs anyway is abandoned rather than blocking
// every alert behind it (a tick is skipped while one is in flight).
const ROW_TIMEOUT_MS = 30_000;
// How long a claimed batch is invisible to other workers. Now derived rather than
// guessed: the worst case really is BATCH_SIZE rows x ROW_TIMEOUT_MS, so a crash
// mid-batch delays the unprocessed rows by at most that. (Was a flat 10 min with
// no bound on batch time at all - because nothing capped a send.)
const CLAIM_LEASE_MS = BATCH_SIZE * ROW_TIMEOUT_MS;

export interface AlertDispatcherDeps {
  db: Db;
  dispatcher: Dispatcher;
  /** optional: send a heads-up to the operator when a row exhausts retries. */
  adminSender?: TelegramSender | null;
  adminChatId?: number | null;
  /** optional Discord fallback for the dead-letter ping (Discord-only deploys). */
  adminDiscordDm?: DiscordDmSender | null;
  adminDiscordUserId?: string | null;
}

export class AlertDispatcherWorker {
  private timer: NodeJS.Timeout | null = null;
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
    // Claim the batch atomically: FOR UPDATE SKIP LOCKED alone is not enough
    // (outside a transaction the row locks die with the statement), so inside
    // one short transaction we select the rows AND push their next_attempt
    // forward as a lease. A second worker (replica, deploy overlap) either
    // skips the locked rows or, after commit, no longer sees them as due -
    // so the same alert can't be sent twice. If we crash mid-batch, the
    // lease expires and the rows simply become due again.
    const ready = await this.deps.db.transaction(async tx => {
      const rows = await tx
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
      if (rows.length > 0) {
        await tx
          .update(schema.pendingAlerts)
          .set({ nextAttempt: new Date(Date.now() + CLAIM_LEASE_MS) })
          .where(
            inArray(
              schema.pendingAlerts.id,
              rows.map(r => r.id)
            )
          );
      }
      return rows;
    });

    if (ready.length === 0) return;
    logger.info(`Draining ${ready.length} pending alert(s)`);

    // Two queries for the whole batch, not two per row. Deliberately NOT joined
    // into the claim above: that SELECT is FOR UPDATE ... SKIP LOCKED, and in
    // Postgres a join would take row locks on users and meters too - tables the
    // bots write to concurrently (/nickname, /threshold). Still read at send time,
    // so channel state is current.
    const [users, meters] = await Promise.all([
      this.deps.db
        .select()
        .from(schema.users)
        .where(inArray(schema.users.id, [...new Set(ready.map(r => r.userId))])),
      this.deps.db
        .select()
        .from(schema.meters)
        .where(inArray(schema.meters.id, [...new Set(ready.map(r => r.meterId))])),
    ]);
    const userById = new Map(users.map(u => [u.id, u]));
    const meterById = new Map(meters.map(m => [m.id, m]));

    for (const row of ready) {
      try {
        await withTimeout(
          this.processRow(row, userById.get(row.userId), meterById.get(row.meterId)),
          ROW_TIMEOUT_MS,
          `pending alert ${row.id}`
        );
      } catch (error) {
        // processRow already records the error on the row; this is a
        // belt-and-braces catch so a single bad row can't kill the loop - or, with
        // the timeout, wedge the worker. The row keeps its lease and comes back.
        logger.error(`Failed to process pending alert ${row.id}`, error);
      }
    }
  }

  private async processRow(
    row: schema.PendingAlert,
    user: schema.User | undefined,
    meter: schema.Meter | undefined
  ): Promise<void> {
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

    if (!user || !meter) {
      // user was deleted between schedule and dispatch. drop the row.
      logger.warn(`Pending alert ${row.id} references deleted user/meter; dropping`);
      await this.deps.db
        .update(schema.pendingAlerts)
        .set({ status: 'failed', lastError: 'user or meter deleted' })
        .where(eq(schema.pendingAlerts.id, row.id));
      return;
    }

    // Quiet hours hold back the nags (low / reminder / recovery); a critical
    // alert - power about to be cut - always goes through. Held rows are
    // DEFERRED until the window ends, never dropped: the scheduler already
    // advanced lastAlertAt, so nothing would ever re-queue this alert.
    // Deferral doesn't touch `attempts` - it isn't a failure.
    const now = new Date();
    if (row.action !== 'critical-alert' && inQuietHours(now, user.quietStart, user.quietEnd)) {
      const resumeAt = quietHoursEnd(now, user.quietEnd as number);
      await this.deps.db
        .update(schema.pendingAlerts)
        .set({ nextAttempt: resumeAt })
        .where(eq(schema.pendingAlerts.id, row.id));
      logger.info(
        `Pending alert ${row.id} held for quiet hours; retrying at ${resumeAt.toISOString()}`
      );
      return;
    }

    // Channels already delivered on a previous attempt, so a retry resends only
    // the ones that failed - never a duplicate.
    const alreadyDelivered = parseDelivered(row.delivered);

    let result: DispatchResult;
    try {
      result = await this.deps.dispatcher.dispatchAlert(
        user,
        meter,
        // DB stores action/level as text, dispatcher takes the same union
        // types. cast through unknown to skip a runtime validator - scheduler
        // is the only writer and uses these literals.
        row.action as never,
        row.level as never,
        ctx,
        alreadyDelivered
      );
    } catch (error) {
      // dispatchAlert isolates each channel and shouldn't throw, so reaching here
      // is a surprise. Nothing was reliably sent this pass, so retry the whole
      // row - the delivered ledger still keeps us from doubling up.
      await this.scheduleRetryOrFail(
        row,
        meter,
        row.attempts + 1,
        error instanceof Error ? error.message : String(error),
        alreadyDelivered
      );
      return;
    }

    const deliveredNow = new Set([...alreadyDelivered, ...result.delivered]);
    if (result.failed.length === 0) {
      // every channel that had something to send succeeded (or there was
      // nothing to send) - the row is done.
      await this.deps.db
        .update(schema.pendingAlerts)
        .set({
          status: 'sent',
          deliveredAt: new Date(),
          delivered: JSON.stringify([...deliveredNow]),
          lastError: null,
        })
        .where(eq(schema.pendingAlerts.id, row.id));
      logger.info(`Pending alert ${row.id} delivered`);
      return;
    }

    // some channels failed - back off and retry just those next time.
    await this.scheduleRetryOrFail(
      row,
      meter,
      row.attempts + 1,
      `channel(s) failed: ${result.failed.join(', ')}`,
      deliveredNow
    );
  }

  // Record a failed attempt: back off and retry until MAX_ATTEMPTS, then
  // dead-letter the row and ping the operator. `delivered` is the cumulative set
  // of channels already sent, persisted so the next attempt skips them.
  private async scheduleRetryOrFail(
    row: schema.PendingAlert,
    meter: schema.Meter,
    attempts: number,
    lastError: string,
    delivered: ReadonlySet<string>
  ): Promise<void> {
    const deliveredJson = JSON.stringify([...delivered]);
    if (attempts >= MAX_ATTEMPTS) {
      await this.deps.db
        .update(schema.pendingAlerts)
        .set({ status: 'failed', attempts, delivered: deliveredJson, lastError })
        .where(eq(schema.pendingAlerts.id, row.id));
      logger.error(
        `Pending alert ${row.id} exhausted retries (${attempts}); marked failed`,
        lastError
      );
      await notifyOperator(
        {
          telegram:
            this.deps.adminSender && this.deps.adminChatId != null
              ? { sender: this.deps.adminSender, chatId: this.deps.adminChatId }
              : null,
          discord:
            this.deps.adminDiscordDm && this.deps.adminDiscordUserId != null
              ? { dm: this.deps.adminDiscordDm, userId: this.deps.adminDiscordUserId }
              : null,
        },
        '🚨 Alert delivery failed',
        `🚨 Alert for meter ${meter.id} (${meter.accountNo}/${meter.meterNo}) failed after ${attempts} attempts. Last error: ${lastError}`
      );
      return;
    }
    const backoffMs = BACKOFF_BASE_MS * 2 ** (attempts - 1);
    await this.deps.db
      .update(schema.pendingAlerts)
      .set({
        attempts,
        nextAttempt: new Date(Date.now() + backoffMs),
        delivered: deliveredJson,
        lastError,
      })
      .where(eq(schema.pendingAlerts.id, row.id));
    logger.warn(
      `Pending alert ${row.id} attempt ${attempts} failed; retrying in ${backoffMs}ms`,
      lastError
    );
  }
}

// the delivered ledger is just a JSON array of channel keys. it only exists to
// avoid re-sending, so if it's ever malformed treat it as nothing-sent-yet.
function parseDelivered(raw: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    // malformed - treat as nothing delivered yet
  }
  return new Set();
}
