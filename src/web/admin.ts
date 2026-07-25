import http from 'http';
import crypto from 'crypto';
import {
  eq,
  and,
  gte,
  lt,
  or,
  ilike,
  desc,
  inArray,
  count,
  max,
  sum,
  sql,
  exists,
  notExists,
} from 'drizzle-orm';
import { Db, schema } from '../db';
import { ServerConfig } from '../config';
import { SubscriptionService } from '../billing';
import { Scheduler } from '../core/scheduler';
import { RateLimiter } from '../core/rate-limiter';
import { eraseUser } from '../core/erase-user';
import { enforceMeterCap } from '../core/meter-cap';
import { atMeterCap } from '../core/meter-usecases';
import {
  isPurchasablePlan,
  maxMetersFor,
  effectiveMeterLimit,
  smsPerMonthFor,
  priceBdtFor,
  billingLive,
} from '../core/plans';
import { getProvider, ProviderUnavailableError } from '../providers';
import { dashboardData } from './queries';
import { logger, maskWebhookUrl } from '../logger';
import { clientIp, csrfHeader, html, isMutating, json, readBody, redirect } from './http-utils';
import { adminAppHtml, adminLoginHtml } from './admin-html';
import {
  adminCookieName,
  signAdminSession,
  verifyAdminSession,
  verifyCsrf,
  csrfFor,
  readCookie,
  sessionCookie,
} from './admin-session';

const PAGE_SIZE = 25;
const PAYMENTS_SHOWN = 20;
const DELIVERIES_PAGE = 40;

export interface AdminDeps {
  db: Db;
  config: ServerConfig;
  subscriptions: SubscriptionService;
  /** per-IP login throttle */
  loginLimiter: RateLimiter;
  /** aggregate login throttle (backstop against IP-rotating brute force) */
  loginGlobalLimiter: RateLimiter;
  /** politeness throttle on operator "re-check balance now" actions (keyed by meter) */
  recheckLimiter: RateLimiter;
  /** the poll scheduler, so the panel can show cycle health and trigger a run */
  scheduler: Scheduler;
  /** per-request CSP nonce; inline <script> blocks must carry it to run */
  nonce: string;
}

// ---- data assembly -------------------------------------------------------

async function overview(db: Db) {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [users, activeMeters, readings, alerts24h, activeSubs, churned, pastDue] =
    await Promise.all([
      db.$count(schema.users),
      db.$count(schema.meters, eq(schema.meters.active, true)),
      db.$count(schema.readings),
      db.$count(schema.alertsLog, gte(schema.alertsLog.sentAt, dayAgo)),
      db.$count(schema.subscriptions, eq(schema.subscriptions.status, 'active')),
      db.$count(
        schema.subscriptions,
        and(
          inArray(schema.subscriptions.status, ['expired', 'cancelled']),
          gte(schema.subscriptions.updatedAt, monthAgo)
        )
      ),
      db.$count(
        schema.subscriptions,
        and(
          eq(schema.subscriptions.status, 'active'),
          lt(schema.subscriptions.currentPeriodEnd, now)
        )
      ),
    ]);
  const [revenue] = await db
    .select({ total: sum(schema.payments.amountBdt) })
    .from(schema.payments);

  // MRR is the sum of the monthly price of every active plan.
  const byPlan = await db
    .select({ plan: schema.subscriptions.plan, n: count() })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.status, 'active'))
    .groupBy(schema.subscriptions.plan);
  const mrr = byPlan.reduce((sum, r) => sum + priceBdtFor(r.plan) * Number(r.n), 0);
  const churnBase = activeSubs + churned;

  return {
    users,
    activeMeters,
    readings,
    alerts24h,
    activeSubscriptions: activeSubs,
    totalPaidBdt: Number(revenue?.total ?? 0),
    mrr,
    arpu: activeSubs > 0 ? Math.round((mrr / activeSubs) * 10) / 10 : 0,
    churnPct: churnBase > 0 ? Math.round((churned / churnBase) * 1000) / 10 : 0,
    pastDue,
  };
}

/** Revenue screen: a 12-month payment series + the most recent payments feed. */
async function revenue(db: Db) {
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const monthExpr = sql<string>`to_char(date_trunc('month', ${schema.payments.createdAt}), 'YYYY-MM')`;
  const series = await db
    .select({ month: monthExpr, total: sum(schema.payments.amountBdt) })
    .from(schema.payments)
    .where(gte(schema.payments.createdAt, yearAgo))
    .groupBy(monthExpr)
    .orderBy(monthExpr);
  const recent = await db
    .select({
      email: schema.users.email,
      plan: schema.users.plan,
      amountBdt: schema.payments.amountBdt,
      provider: schema.payments.provider,
      status: schema.payments.status,
      createdAt: schema.payments.createdAt,
    })
    .from(schema.payments)
    .innerJoin(schema.users, eq(schema.payments.userId, schema.users.id))
    .orderBy(desc(schema.payments.createdAt))
    .limit(PAYMENTS_SHOWN);
  return {
    mrrSeries: series.map(r => ({ month: r.month, total: Number(r.total ?? 0) })),
    payments: recent.map(p => ({
      user: p.email ?? 'telegram user',
      plan: p.plan,
      amountBdt: p.amountBdt,
      provider: p.provider,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

/** Delivery logs: real per-send rows from alerts_log + 24h delivery counts, filterable and paged. */
async function deliveries(db: Db, status: string, channel: string, page: number) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [delivered24h, failed24h] = await Promise.all([
    db.$count(
      schema.alertsLog,
      and(gte(schema.alertsLog.sentAt, dayAgo), eq(schema.alertsLog.deliveryStatus, 'sent'))
    ),
    db.$count(
      schema.alertsLog,
      and(gte(schema.alertsLog.sentAt, dayAgo), eq(schema.alertsLog.deliveryStatus, 'failed'))
    ),
  ]);
  const conds = [];
  if (status === 'sent' || status === 'failed') {
    conds.push(eq(schema.alertsLog.deliveryStatus, status));
  }
  // telegram rides users.telegram_chat_id with no channel row, so match a null type
  if (channel === 'telegram') {
    conds.push(sql`${schema.channels.type} is null`);
  } else if (
    channel === 'email' ||
    channel === 'sms' ||
    channel === 'discord' ||
    channel === 'discord-dm' ||
    channel === 'whatsapp'
  ) {
    conds.push(eq(schema.channels.type, channel));
  }
  const rows = await db
    .select({
      sentAt: schema.alertsLog.sentAt,
      level: schema.alertsLog.level,
      action: schema.alertsLog.action,
      deliveryStatus: schema.alertsLog.deliveryStatus,
      meterNo: schema.meters.meterNo,
      chType: schema.channels.type,
      chAddr: schema.channels.address,
      tgChat: schema.users.telegramChatId,
      userId: schema.users.id,
    })
    .from(schema.alertsLog)
    .innerJoin(schema.meters, eq(schema.alertsLog.meterId, schema.meters.id))
    .innerJoin(schema.users, eq(schema.meters.userId, schema.users.id))
    .leftJoin(schema.channels, eq(schema.alertsLog.channelId, schema.channels.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(schema.alertsLog.sentAt))
    .limit(DELIVERIES_PAGE + 1)
    .offset(page * DELIVERIES_PAGE);
  const hasMore = rows.length > DELIVERIES_PAGE;
  return {
    delivered24h,
    failed24h,
    page,
    hasMore,
    rows: rows.slice(0, DELIVERIES_PAGE).map(r => ({
      sentAt: r.sentAt.toISOString(),
      meterNo: r.meterNo,
      channel: r.chType ?? 'telegram',
      // webhook URLs carry a secret token - mask them even for the operator
      recipient:
        r.chType === 'discord' && r.chAddr
          ? maskWebhookUrl(r.chAddr)
          : (r.chAddr ?? (r.tgChat !== null ? `chat ${r.tgChat}` : 'n/a')),
      level: r.level,
      action: r.action,
      status: r.deliveryStatus,
      userId: r.userId,
    })),
  };
}

/** Readings older than 2x the poll interval mean the meter has effectively gone dark. */
export function staleCutoff(pollIntervalHours: number, now = new Date()): Date {
  return new Date(now.getTime() - 2 * pollIntervalHours * 60 * 60 * 1000);
}

/** Poll-cycle health for the ops card: last completion, whether it's overdue, and if a run is in flight. */
function pollStatus(scheduler: Scheduler, pollIntervalHours: number) {
  const last = scheduler.lastCycleCompletedAt;
  const intervalMs = pollIntervalHours * 60 * 60 * 1000;
  const overdue = last ? Date.now() - last.getTime() > intervalMs * 2 : false;
  return {
    lastCycleAt: last?.toISOString() ?? null,
    intervalHours: pollIntervalHours,
    overdue,
    running: scheduler.isPolling,
  };
}

/** Dead-letter outbox rows: alerts stuck in 'failed' over the last 24h. */
async function deadLetters(db: Db) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(schema.pendingAlerts)
    .where(
      and(eq(schema.pendingAlerts.status, 'failed'), gte(schema.pendingAlerts.createdAt, dayAgo))
    )
    .orderBy(desc(schema.pendingAlerts.createdAt))
    .limit(PAGE_SIZE);
  return {
    count: rows.length,
    rows: rows.map(r => ({
      id: r.id,
      action: r.action,
      level: r.level,
      attempts: r.attempts,
      lastError: r.lastError,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// Reset failed outbox rows to 'pending' so the dispatcher worker retries them.
// Uses the worker's own status literal ('pending') - no new states.
async function requeueDeadLetters(
  db: Db,
  id: number | null
): Promise<{ status: number; body: unknown }> {
  const target =
    id === null ? eq(schema.pendingAlerts.status, 'failed') : eq(schema.pendingAlerts.id, id);
  await db
    .update(schema.pendingAlerts)
    .set({ status: 'pending', attempts: 0, nextAttempt: new Date(), lastError: null })
    .where(and(target, eq(schema.pendingAlerts.status, 'failed')));
  return { status: 200, body: { ok: true } };
}

async function userList(
  db: Db,
  q: string,
  page: number,
  filter: string,
  pollIntervalHours: number
) {
  const filters = [];
  if (q) {
    const ors = [ilike(schema.users.email, `%${q}%`)];
    // operators get handed meter numbers and nicknames from support chats, so
    // match any of the user's meters too (nickname always, account/meter when numeric)
    const meterConds = [ilike(schema.meters.nickname, `%${q}%`)];
    if (/^\d+$/.test(q)) {
      ors.push(eq(schema.users.telegramChatId, Number(q)));
      // discord snowflakes are numeric too (stored as text)
      ors.push(eq(schema.users.discordUserId, q));
      meterConds.push(
        ilike(schema.meters.accountNo, `%${q}%`),
        ilike(schema.meters.meterNo, `%${q}%`)
      );
    }
    ors.push(
      exists(
        db
          .select({ x: sql`1` })
          .from(schema.meters)
          .where(and(eq(schema.meters.userId, schema.users.id), or(...meterConds)))
      )
    );
    filters.push(or(...ors));
  }

  const now = new Date();
  if (filter === 'paid') {
    filters.push(sql`${schema.users.plan} <> 'free'`);
  } else if (filter === 'pastdue') {
    filters.push(
      exists(
        db
          .select({ x: sql`1` })
          .from(schema.subscriptions)
          .where(
            and(
              eq(schema.subscriptions.userId, schema.users.id),
              eq(schema.subscriptions.status, 'active'),
              lt(schema.subscriptions.currentPeriodEnd, now)
            )
          )
      )
    );
  } else if (filter === 'stale') {
    // stale = no reading within 2x the poll interval (covers "never read" too)
    filters.push(
      notExists(
        db
          .select({ x: sql`1` })
          .from(schema.readings)
          .innerJoin(schema.meters, eq(schema.readings.meterId, schema.meters.id))
          .where(
            and(
              eq(schema.meters.userId, schema.users.id),
              gte(schema.readings.fetchedAt, staleCutoff(pollIntervalHours, now))
            )
          )
      )
    );
  }

  const where = filters.length > 0 ? and(...filters) : undefined;
  const total = await db.$count(schema.users, where);

  const rows = await db
    .select()
    .from(schema.users)
    .where(where)
    .orderBy(desc(schema.users.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(page * PAGE_SIZE);

  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);
  const ids = pageRows.map(u => u.id);

  const meterCounts = new Map<number, number>();
  const lastReadings = new Map<number, string>();
  if (ids.length > 0) {
    const counts = await db
      .select({ userId: schema.meters.userId, n: count() })
      .from(schema.meters)
      .where(and(inArray(schema.meters.userId, ids), eq(schema.meters.active, true)))
      .groupBy(schema.meters.userId);
    for (const c of counts) {
      meterCounts.set(c.userId, Number(c.n));
    }
    const lasts = await db
      .select({ userId: schema.meters.userId, last: max(schema.readings.fetchedAt) })
      .from(schema.readings)
      .innerJoin(schema.meters, eq(schema.readings.meterId, schema.meters.id))
      .where(inArray(schema.meters.userId, ids))
      .groupBy(schema.meters.userId);
    for (const r of lasts) {
      if (r.last) {
        lastReadings.set(r.userId, r.last.toISOString());
      }
    }
  }

  return {
    page,
    hasMore,
    total,
    users: pageRows.map(u => ({
      id: u.id,
      telegramChatId: u.telegramChatId,
      discordUserId: u.discordUserId,
      email: u.email,
      plan: u.plan,
      createdAt: u.createdAt.toISOString(),
      activeMeters: meterCounts.get(u.id) ?? 0,
      lastReadingAt: lastReadings.get(u.id) ?? null,
    })),
  };
}

async function userDetail(db: Db, subscriptions: SubscriptionService, userId: number) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return null;
  }
  const allMeters = await db.select().from(schema.meters).where(eq(schema.meters.userId, userId));
  const meterIds = allMeters.map(m => m.id);
  const subscription = await subscriptions.activeFor(userId);
  const payments = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.userId, userId))
    .orderBy(desc(schema.payments.createdAt))
    .limit(PAYMENTS_SHOWN);
  // what an erase would destroy, so the operator confirms against real counts
  const [readingCount, paymentCount] = await Promise.all([
    meterIds.length > 0
      ? db.$count(schema.readings, inArray(schema.readings.meterId, meterIds))
      : Promise.resolve(0),
    db.$count(schema.payments, eq(schema.payments.userId, userId)),
  ]);

  return {
    user: {
      id: user.id,
      telegramChatId: user.telegramChatId,
      discordUserId: user.discordUserId,
      email: user.email,
      plan: user.plan,
      // null = following the plan default; a number is the operator override
      meterLimit: user.meterLimit,
      tonePref: user.tonePref,
      createdAt: user.createdAt.toISOString(),
    },
    limits: {
      maxMeters: effectiveMeterLimit(user),
      planMaxMeters: maxMetersFor(user.plan),
      smsPerMonth: smsPerMonthFor(user.plan),
    },
    impact: { meters: allMeters.length, readings: readingCount, payments: paymentCount },
    active: await dashboardData(db, userId),
    pausedMeters: allMeters
      .filter(m => !m.active)
      .map(m => ({ id: m.id, meterNo: m.meterNo, accountNo: m.accountNo, nickname: m.nickname })),
    subscription: subscription
      ? {
          plan: subscription.plan,
          status: subscription.status,
          provider: subscription.provider,
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
        }
      : null,
    payments: payments.map(p => ({
      amountBdt: p.amountBdt,
      provider: p.provider,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

// ---- actions -------------------------------------------------------------

async function grant(
  db: Db,
  subscriptions: SubscriptionService,
  userId: number,
  bodyText: string
): Promise<{ status: number; body: unknown }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText || '{}');
  } catch {
    return { status: 400, body: { error: 'Invalid JSON.' } };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { status: 400, body: { error: 'Invalid body.' } };
  }
  const body = parsed as Record<string, unknown>;
  const plan = typeof body.plan === 'string' ? body.plan : '';
  const days =
    body.days === undefined
      ? 30
      : typeof body.days === 'number'
        ? body.days
        : typeof body.days === 'string'
          ? Number(body.days)
          : NaN;
  if (!isPurchasablePlan(plan)) {
    return { status: 400, body: { error: 'Unknown plan.' } };
  }
  if (!Number.isFinite(days) || days <= 0 || days > 3650) {
    return { status: 400, body: { error: 'Days must be between 1 and 3650.' } };
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return { status: 404, body: { error: 'No such user.' } };
  }
  await subscriptions.grant(userId, plan, days);
  return { status: 200, body: { ok: true } };
}

/** Build the audit `detail` for a grant: plan / days / operator reason, not raw JSON. */
function grantAuditDetail(bodyText: string): string | null {
  try {
    const b = JSON.parse(bodyText || '{}') as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof b.plan === 'string') parts.push(`plan=${b.plan}`);
    if (typeof b.days === 'number' || typeof b.days === 'string') parts.push(`days=${b.days}`);
    if (typeof b.reason === 'string' && b.reason.trim()) {
      parts.push(`reason=${b.reason.trim().slice(0, 150)}`);
    }
    return parts.join(' ') || null;
  } catch {
    return null;
  }
}

async function pause(db: Db, userId: number): Promise<{ status: number; body: unknown }> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return { status: 404, body: { error: 'No such user.' } };
  }
  await db.update(schema.meters).set({ active: false }).where(eq(schema.meters.userId, userId));
  return { status: 200, body: { ok: true } };
}

async function erase(db: Db, userId: number): Promise<{ status: number; body: unknown }> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return { status: 404, body: { error: 'No such user.' } };
  }
  await eraseUser(db, userId);
  return { status: 200, body: { ok: true } };
}

/** Reactivate paused meters, oldest first, up to the plan cap; report how many stayed paused. */
async function resumeAllMeters(db: Db, userId: number): Promise<{ status: number; body: unknown }> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return { status: 404, body: { error: 'No such user.' } };
  }
  const all = await db
    .select()
    .from(schema.meters)
    .where(eq(schema.meters.userId, userId))
    .orderBy(schema.meters.createdAt);
  const activeCount = all.filter(m => m.active).length;
  const inactive = all.filter(m => !m.active);
  const slots = Math.max(0, effectiveMeterLimit(user) - activeCount);
  const toActivate = inactive.slice(0, slots);
  if (toActivate.length > 0) {
    await db
      .update(schema.meters)
      .set({ active: true })
      .where(
        inArray(
          schema.meters.id,
          toActivate.map(m => m.id)
        )
      );
  }
  return {
    status: 200,
    body: {
      ok: true,
      resumed: toActivate.length,
      stillPaused: inactive.length - toActivate.length,
    },
  };
}

/** Pause or resume a single meter. A resume is refused if the plan cap is already full. */
async function setMeterActive(
  db: Db,
  userId: number,
  meterId: number,
  active: boolean
): Promise<{ status: number; body: unknown }> {
  const [meter] = await db
    .select()
    .from(schema.meters)
    .where(and(eq(schema.meters.id, meterId), eq(schema.meters.userId, userId)));
  if (!meter) {
    return { status: 404, body: { error: 'No such meter.' } };
  }
  if (active && !meter.active) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (user && (await atMeterCap(db, user))) {
      return {
        status: 400,
        body: { error: 'Plan meter cap is full - pause another meter or raise the plan first.' },
      };
    }
  }
  await db.update(schema.meters).set({ active }).where(eq(schema.meters.id, meterId));
  return { status: 200, body: { ok: true, active } };
}

/** Cancel the active subscription, drop to free, and pause meters beyond the free cap. */
async function revoke(
  db: Db,
  subscriptions: SubscriptionService,
  userId: number
): Promise<{ status: number; body: unknown }> {
  const subscription = await subscriptions.activeFor(userId);
  if (!subscription) {
    return { status: 400, body: { error: 'No active subscription to revoke.' } };
  }
  await db
    .update(schema.subscriptions)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(schema.subscriptions.id, subscription.id));
  await db.update(schema.users).set({ plan: 'free' }).where(eq(schema.users.id, userId));
  const paused = await enforceMeterCap(db, userId, 'free');
  return { status: 200, body: { ok: true, pausedMeters: paused } };
}

// A sanity ceiling on the operator override. Not a business rule, just a guard so
// a fat-fingered "1000" can't quietly point the scheduler at a thousand meters.
const MAX_METER_LIMIT = 100;

/**
 * Set or clear this account's meter-cap override. Blank hands the account back to
 * its plan default. Lowering the cap pauses the excess immediately (oldest kept),
 * the same way a plan downgrade does, so the number always reflects reality.
 */
async function setMeterLimit(
  db: Db,
  userId: number,
  bodyText: string
): Promise<{ status: number; body: unknown }> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return { status: 404, body: { error: 'No such user.' } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText || '{}');
  } catch {
    return { status: 400, body: { error: 'Invalid JSON.' } };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { status: 400, body: { error: 'Invalid body.' } };
  }
  const raw = (parsed as Record<string, unknown>).limit;

  if (raw === null || raw === undefined || raw === '') {
    await db.update(schema.users).set({ meterLimit: null }).where(eq(schema.users.id, userId));
    const paused = await enforceMeterCap(db, userId, user.plan);
    return {
      status: 200,
      body: {
        ok: true,
        meterLimit: null,
        effective: maxMetersFor(user.plan),
        pausedMeters: paused,
      },
    };
  }

  const limit =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw) : Number.NaN;
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_METER_LIMIT) {
    return {
      status: 400,
      body: {
        error: `Meter limit must be a whole number from 0 to ${MAX_METER_LIMIT}, or blank to use the plan default.`,
      },
    };
  }
  await db.update(schema.users).set({ meterLimit: limit }).where(eq(schema.users.id, userId));
  const paused = await enforceMeterCap(db, userId, user.plan);
  return {
    status: 200,
    body: { ok: true, meterLimit: limit, effective: limit, pausedMeters: paused },
  };
}

/** Poll DESCO for one meter right now, store the reading, and hand back the balance. */
async function recheckMeter(
  db: Db,
  userId: number,
  meterId: number
): Promise<{ status: number; body: unknown }> {
  const [meter] = await db
    .select()
    .from(schema.meters)
    .where(and(eq(schema.meters.id, meterId), eq(schema.meters.userId, userId)));
  if (!meter) {
    return { status: 404, body: { error: 'No such meter.' } };
  }
  try {
    const data = await getProvider(meter.provider).getBalance({
      accountNo: meter.accountNo,
      meterNo: meter.meterNo,
    });
    await db.insert(schema.readings).values({ meterId, balance: data.balance });
    return { status: 200, body: { ok: true, balance: data.balance } };
  } catch (error) {
    // tell "DESCO is down" (retry) apart from "bad numbers" (won't fix itself)
    if (error instanceof ProviderUnavailableError) {
      return { status: 502, body: { error: 'DESCO is unavailable right now. Try again shortly.' } };
    }
    return {
      status: 400,
      body: { error: "DESCO doesn't recognize that account/meter combo." },
    };
  }
}

/** Append a row to the operator action trail. Best-effort: a failed write is
 *  logged but never blocks the action it records. */
async function recordAudit(
  db: Db,
  action: string,
  targetUserId: number | null,
  ip: string,
  detail: string | null
): Promise<void> {
  try {
    await db.insert(schema.adminAudit).values({ action, targetUserId, ip, detail });
  } catch (error) {
    logger.error('admin audit write failed', error);
  }
}

async function auditList(db: Db, page: number) {
  const rows = await db
    .select()
    .from(schema.adminAudit)
    .orderBy(desc(schema.adminAudit.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(page * PAGE_SIZE);
  const hasMore = rows.length > PAGE_SIZE;
  return {
    page,
    hasMore,
    entries: rows.slice(0, PAGE_SIZE).map(r => ({
      action: r.action,
      targetUserId: r.targetUserId,
      detail: r.detail,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ---- router --------------------------------------------------------------

/**
 * Owns every /admin* route. Returns true when it handled the request (so the
 * main server can stop). The whole panel is disabled (404) unless ADMIN_PASSWORD
 * is set, so a deploy that forgets it can never expose customer data.
 */
export async function handleAdminRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: AdminDeps
): Promise<boolean> {
  const {
    db,
    config,
    subscriptions,
    loginLimiter,
    loginGlobalLimiter,
    recheckLimiter,
    scheduler,
    nonce,
  } = deps;
  const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);
  const path = url.pathname;

  if (path !== '/admin' && !path.startsWith('/admin/')) {
    return false;
  }
  const adminPassword = config.adminPassword;
  if (adminPassword === null) {
    res.writeHead(404).end();
    return true;
  }

  const secret = config.adminSessionSecret;
  const secure = config.publicBaseUrl.startsWith('https');
  const cookie = readCookie(req, adminCookieName(secure)) ?? '';
  const authed = verifyAdminSession(cookie, secret);
  const method = req.method ?? 'GET';

  // --- auth pages & actions ---
  if (path === '/admin' && method === 'GET') {
    if (authed) {
      html(res, 200, adminAppHtml(nonce, csrfFor(cookie, secret), billingLive(config.billing)));
    } else {
      html(res, 200, adminLoginHtml(nonce, url.searchParams.has('error')));
    }
    return true;
  }

  if (path === '/admin/login' && method === 'POST') {
    // per-IP throttle, plus an aggregate cap so an attacker rotating IPs can't
    // get a fresh budget per address
    const ipOk = loginLimiter.allow(clientIp(req));
    const globalOk = loginGlobalLimiter.allow('admin-login');
    if (!ipOk || !globalOk) {
      html(
        res,
        429,
        adminLoginHtml(nonce, true, 'Too many attempts. Wait a few minutes and try again.')
      );
      return true;
    }
    const password = new URLSearchParams(await readBody(req)).get('password') ?? '';
    if (!timingSafeStringEqual(password, adminPassword)) {
      redirect(res, '/admin?error=1');
      return true;
    }
    redirect(res, '/admin', sessionCookie(signAdminSession(secret), secure));
    return true;
  }

  if (path === '/admin/logout' && method === 'POST') {
    // A plain form POST (no JS), so the token rides in the body rather than the
    // X-CSRF-Token header the API routes use. Without this a cross-site POST
    // could sign an operator out.
    const csrf = new URLSearchParams(await readBody(req)).get('csrf') ?? '';
    if (!verifyCsrf(cookie, csrf, secret)) {
      redirect(res, '/admin');
      return true;
    }
    redirect(res, '/admin', sessionCookie('', secure, 0));
    return true;
  }

  // --- everything below is JSON API and requires a valid session ---
  if (path.startsWith('/admin/api/')) {
    if (!authed) {
      json(res, 401, { error: 'Not signed in.' });
      return true;
    }

    // One CSRF gate for every mutating API route. This used to be pasted into
    // each mutating branch, so a new route shipped unprotected if you forgot -
    // and nothing would have caught it. Gated on the method, not on POST, so a
    // future PUT/PATCH/DELETE is covered by default.
    if (isMutating(method) && !verifyCsrf(cookie, csrfHeader(req), secret)) {
      json(res, 403, { error: 'Bad or missing CSRF token.' });
      return true;
    }

    if (path === '/admin/api/overview' && method === 'GET') {
      const data = await overview(db);
      json(res, 200, { ...data, poll: pollStatus(scheduler, config.pollIntervalHours) });
      return true;
    }

    if (path === '/admin/api/deadletters' && method === 'GET') {
      json(res, 200, await deadLetters(db));
      return true;
    }

    if (path === '/admin/api/poll' && method === 'POST') {
      if (scheduler.isPolling) {
        json(res, 200, { ok: true, alreadyRunning: true });
        return true;
      }
      void scheduler.runOnce();
      await recordAudit(db, 'poll-run', null, clientIp(req), null);
      json(res, 200, { ok: true, started: true });
      return true;
    }

    // requeue-all must be matched before the :id form
    const requeueMatch = /^\/admin\/api\/alerts\/(requeue-all|(\d+)\/requeue)$/.exec(path);
    if (requeueMatch && method === 'POST') {
      const id = requeueMatch[2] ? parseInt(requeueMatch[2]) : null;
      const result = await requeueDeadLetters(db, id);
      if (result.status === 200) {
        await recordAudit(db, 'requeue', null, clientIp(req), id === null ? 'all' : `alert ${id}`);
      }
      json(res, result.status, result.body);
      return true;
    }

    if (path === '/admin/api/audit' && method === 'GET') {
      const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0') || 0);
      json(res, 200, await auditList(db, page));
      return true;
    }

    if (path === '/admin/api/revenue' && method === 'GET') {
      json(res, 200, await revenue(db));
      return true;
    }

    if (path === '/admin/api/deliveries' && method === 'GET') {
      const dStatus = url.searchParams.get('status') ?? 'all';
      const dChannel = url.searchParams.get('channel') ?? 'all';
      const dPage = Math.max(0, parseInt(url.searchParams.get('page') ?? '0') || 0);
      json(res, 200, await deliveries(db, dStatus, dChannel, dPage));
      return true;
    }

    if (path === '/admin/api/users' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
      const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0') || 0);
      const filter = url.searchParams.get('filter') ?? 'all';
      json(res, 200, await userList(db, q, page, filter, config.pollIntervalHours));
      return true;
    }

    // Per-meter actions: pause / resume one meter, or re-poll DESCO for it.
    const meterMatch = /^\/admin\/api\/users\/(\d+)\/meters\/(\d+)\/(pause|resume|recheck)$/.exec(
      path
    );
    if (meterMatch && method === 'POST') {
      const userId = parseInt(meterMatch[1]);
      const meterId = parseInt(meterMatch[2]);
      const meterAction = meterMatch[3];
      let result: { status: number; body: unknown };
      if (meterAction === 'recheck') {
        if (!recheckLimiter.allow(String(meterId))) {
          json(res, 429, { error: 'Too many re-checks for this meter. Give it a few minutes.' });
          return true;
        }
        result = await recheckMeter(db, userId, meterId);
      } else {
        result = await setMeterActive(db, userId, meterId, meterAction === 'resume');
      }
      if (result.status === 200) {
        await recordAudit(db, `meter-${meterAction}`, userId, clientIp(req), `meter ${meterId}`);
      }
      json(res, result.status, result.body);
      return true;
    }

    const userMatch =
      /^\/admin\/api\/users\/(\d+)(?:\/(grant|pause|erase|resume|revoke|meterlimit))?$/.exec(path);
    if (userMatch) {
      const userId = parseInt(userMatch[1]);
      const action = userMatch[2];

      if (!action && method === 'GET') {
        const detail = await userDetail(db, subscriptions, userId);
        if (!detail) {
          json(res, 404, { error: 'No such user.' });
          return true;
        }
        json(res, 200, detail);
        return true;
      }

      if (action && method === 'POST') {
        // Mutations need the CSRF token echoed back from the page.
        let result: { status: number; body: unknown };
        let detail: string | null = null;
        if (action === 'grant') {
          const bodyText = await readBody(req);
          result = await grant(db, subscriptions, userId, bodyText);
          // record a readable detail (plan / days / operator reason), not raw JSON
          detail = grantAuditDetail(bodyText);
        } else if (action === 'meterlimit') {
          const bodyText = await readBody(req);
          result = await setMeterLimit(db, userId, bodyText);
          const applied = (result.body as { meterLimit?: number | null }).meterLimit;
          detail = applied === null ? 'cleared (plan default)' : `limit ${String(applied)}`;
        } else if (action === 'pause') {
          result = await pause(db, userId);
        } else if (action === 'resume') {
          result = await resumeAllMeters(db, userId);
        } else if (action === 'revoke') {
          result = await revoke(db, subscriptions, userId);
        } else {
          result = await erase(db, userId);
        }
        // only record actions that actually took effect
        if (result.status === 200) {
          await recordAudit(db, action, userId, clientIp(req), detail);
        }
        json(res, result.status, result.body);
        return true;
      }
    }

    json(res, 404, { error: 'Unknown admin endpoint.' });
    return true;
  }

  res.writeHead(404).end();
  return true;
}

/** Constant-time string compare. Differing lengths can't be compared in constant
 *  time, so we hash both sides to a fixed width first and compare those. */
function timingSafeStringEqual(a: string, b: string): boolean {
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}
