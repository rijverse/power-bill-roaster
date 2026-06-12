import http from 'http';
import { eq, and, gte, desc, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';
import { Scheduler } from '../core/scheduler';
import { predictRunOut } from '../core/prediction';
import { ServerConfig } from '../config';
import { verifyDashboardToken } from './token';
import { dashboardHtml } from './dashboard-html';

const HISTORY_DAYS = 30;

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function dashboardData(db: Db, userId: number) {
  const meters = await db
    .select()
    .from(schema.meters)
    .where(and(eq(schema.meters.userId, userId), eq(schema.meters.active, true)));
  if (meters.length === 0) {
    return { meters: [] };
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
  };
}

export function createWebServer(db: Db, scheduler: Scheduler, config: ServerConfig): http.Server {
  const startedAt = Date.now();

  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);

      if (url.pathname === '/health') {
        const intervalMs = config.pollIntervalHours * 60 * 60 * 1000;
        const last = scheduler.lastCycleCompletedAt;
        // allow one full interval of grace before the first cycle completes
        const overdue = last
          ? Date.now() - last.getTime() > intervalMs * 2
          : Date.now() - startedAt > intervalMs;
        json(res, overdue ? 503 : 200, {
          status: overdue ? 'stale' : 'ok',
          lastPollCycleAt: last?.toISOString() ?? null,
        });
        return;
      }

      if (url.pathname === '/dash' || url.pathname === '/dash/data') {
        const userId = verifyDashboardToken(
          url.searchParams.get('t') ?? '',
          config.dashboardSecret
        );
        if (userId === null) {
          json(res, 401, { error: 'Link expired or invalid. Get a fresh one with /dashboard.' });
          return;
        }
        if (url.pathname === '/dash/data') {
          json(res, 200, await dashboardData(db, userId));
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(dashboardHtml(url.searchParams.get('t')!));
        }
        return;
      }

      res.writeHead(404).end();
    })().catch((error: unknown) => {
      console.error('Web request failed:', error);
      if (!res.headersSent) {
        json(res, 500, { error: 'Something broke on our side.' });
      }
    });
  });
}
