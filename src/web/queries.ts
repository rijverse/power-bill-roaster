import { eq, and, gte, desc, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';
import { predictRunOut } from '../core/prediction';

const HISTORY_DAYS = 30;

/**
 * Per-user meter view shared by the customer dashboard (/dash) and the operator
 * admin panel: active meters with their last 30 days of readings, a run-out
 * prediction, and the 10 most recent alerts. Pure read - no auth concerns here.
 */
export async function dashboardData(db: Db, userId: number) {
  const all = await db.select().from(schema.meters).where(eq(schema.meters.userId, userId));
  const meters = all.filter(m => m.active);
  // Paused meters keep their history and thresholds, so they have to stay
  // visible: without them a pause (the user's own, or an operator's) is
  // indistinguishable from an empty account and there's nothing to resume.
  const pausedMeters = all
    .filter(m => !m.active)
    .map(m => ({
      id: m.id,
      label: m.nickname ?? `Meter ${m.meterNo}`,
      meterNo: m.meterNo,
      accountNo: m.accountNo,
    }));
  if (meters.length === 0) {
    return { meters: [], alerts: [], pausedMeters };
  }
  const meterIds = meters.map(m => m.id);
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);

  const readings = await db
    .select({
      meterId: schema.readings.meterId,
      balance: schema.readings.balance,
      fetchedAt: schema.readings.fetchedAt,
    })
    .from(schema.readings)
    .where(and(inArray(schema.readings.meterId, meterIds), gte(schema.readings.fetchedAt, since)))
    .orderBy(schema.readings.fetchedAt);

  const alerts = await db
    .select({
      meterId: schema.alertsLog.meterId,
      level: schema.alertsLog.level,
      action: schema.alertsLog.action,
      sentAt: schema.alertsLog.sentAt,
    })
    .from(schema.alertsLog)
    .where(inArray(schema.alertsLog.meterId, meterIds))
    .orderBy(desc(schema.alertsLog.sentAt))
    .limit(10);

  return {
    meters: meters.map(meter => {
      const series = readings.filter(r => r.meterId === meter.id);
      const latest = series.length > 0 ? series[series.length - 1].balance : null;
      const prediction =
        latest !== null
          ? predictRunOut(
              series.map(r => ({ balance: r.balance, at: r.fetchedAt })),
              latest
            )
          : null;
      return {
        id: meter.id,
        label: meter.nickname ?? `Meter ${meter.meterNo}`,
        meterNo: meter.meterNo,
        accountNo: meter.accountNo,
        lowThreshold: meter.lowThreshold,
        criticalThreshold: meter.criticalThreshold,
        balance: latest,
        prediction,
        readings: series.map(r => ({ t: r.fetchedAt.toISOString(), balance: r.balance })),
      };
    }),
    alerts: alerts.map(a => ({
      meterId: a.meterId,
      level: a.level,
      action: a.action,
      sentAt: a.sentAt.toISOString(),
    })),
    pausedMeters,
  };
}
