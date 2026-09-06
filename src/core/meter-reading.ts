import { eq } from 'drizzle-orm';
import { Db, schema } from '../db';
import { evaluate, AlertStateSnapshot, AlertLevel } from './alert-machine';
import { recentPrediction } from './meter-usecases';
import { MeterContext } from '../notifications/alert-copy';
import { BalanceData } from '../types';

// Storing a balance read is three writes, not one: the reading row, the
// alert_state snapshot, and - when a threshold is crossed - the outbox row.
// Every surface that reads a balance goes through here (the poll cycle, adding
// a meter on the dashboard, a force check, the operator's re-check) because
// writing only the reading is a silent failure: the dashboard looks right and
// the alert never fires.

export interface ReadingRecord {
  balance: number;
  currentMonthConsumption?: number | null;
  readingTime?: string | null;
}

export interface RecordReadingOptions {
  reminderIntervalMs: number;
  rechargeUrl: string;
  now?: Date;
  /** alert_state carried in on the poll cycle's join, to save a select per meter. */
  joinedState?: schema.AlertStateRow | null;
}

export interface RecordReadingResult {
  level: AlertLevel;
  alertQueued: boolean;
}

export function readingFromBalance(data: BalanceData): ReadingRecord {
  return {
    balance: data.balance,
    currentMonthConsumption: data.currentMonthConsumption ?? null,
    readingTime: data.readingTime ?? null,
  };
}

export async function recordReading(
  db: Db,
  meter: schema.Meter,
  userId: number,
  data: ReadingRecord,
  opts: RecordReadingOptions
): Promise<RecordReadingResult> {
  const { balance } = data;
  const now = opts.now ?? new Date();

  await db.insert(schema.readings).values({
    meterId: meter.id,
    balance,
    currentMonthConsumption: data.currentMonthConsumption ?? null,
    readingTime: data.readingTime ?? null,
  });

  // The poll cycle holds the poll lock and owns every column here except
  // remindersSnoozedUntil, which the snooze button can write underneath it. So
  // the joined row is a free ride for the healthy majority, and a meter already
  // in alert gets a re-read. Callers with no joined row (the dashboard, the
  // operator console) always select.
  const stateRow =
    opts.joinedState === undefined || (opts.joinedState && opts.joinedState.level !== 'ok')
      ? ((
          await db.select().from(schema.alertState).where(eq(schema.alertState.meterId, meter.id))
        )[0] ??
        opts.joinedState ??
        null)
      : opts.joinedState;

  const prev: AlertStateSnapshot = {
    level: (stateRow?.level ?? 'ok') as AlertLevel,
    lastAlertAt: stateRow?.lastAlertAt ?? null,
    lastBalance: stateRow?.lastBalance ?? null,
    remindersSnoozedUntil: stateRow?.remindersSnoozedUntil ?? null,
  };

  const decision = evaluate(
    prev,
    balance,
    { low: meter.lowThreshold, critical: meter.criticalThreshold },
    now,
    opts.reminderIntervalMs
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
    await db
      .insert(schema.alertState)
      .values({ meterId: meter.id, ...stateUpdate })
      .onConflictDoUpdate({ target: schema.alertState.meterId, set: stateUpdate });
    return { level: decision.level, alertQueued: false };
  }

  const ctx: MeterContext = {
    nickname: meter.nickname,
    accountNo: meter.accountNo,
    meterNo: meter.meterNo,
    balance,
    lowThreshold: meter.lowThreshold,
    criticalThreshold: meter.criticalThreshold,
    prediction: await recentPrediction(db, meter.id, balance, now),
    rechargeUrl: opts.rechargeUrl,
  };

  // wrap alert_state + pending_alerts in one transaction so a crash between
  // them can't leave lastAlertAt advanced but no row queued (silencing the
  // user) or vice versa (sending the same alert twice).
  await db.transaction(async tx => {
    await tx
      .insert(schema.alertState)
      .values({ meterId: meter.id, ...stateUpdate })
      .onConflictDoUpdate({ target: schema.alertState.meterId, set: stateUpdate });
    await tx.insert(schema.pendingAlerts).values({
      meterId: meter.id,
      userId,
      action: decision.action,
      level: decision.level,
      payload: JSON.stringify(ctx),
    });
  });

  return { level: decision.level, alertQueued: true };
}
