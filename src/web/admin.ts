import http from 'http';
import crypto from 'crypto';
import { eq, and, gte, or, ilike, desc, inArray, count, max, sum } from 'drizzle-orm';
import { Db, schema } from '../db';
import { ServerConfig } from '../config';
import { SubscriptionService } from '../billing';
import { RateLimiter } from '../core/rate-limiter';
import { eraseUser } from '../core/erase-user';
import { isPurchasablePlan, maxMetersFor, smsPerMonthFor } from '../core/plans';
import { dashboardData } from './queries';
import { adminAppHtml, adminLoginHtml } from './admin-html';
import {
  ADMIN_COOKIE,
  signAdminSession,
  verifyAdminSession,
  verifyCsrf,
  csrfFor,
  readCookie,
  sessionCookie,
} from './admin-session';

const MAX_BODY_BYTES = 16 * 1024;
const PAGE_SIZE = 25;
const PAYMENTS_SHOWN = 20;

export interface AdminDeps {
  db: Db;
  config: ServerConfig;
  subscriptions: SubscriptionService;
  loginLimiter: RateLimiter;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function html(res: http.ServerResponse, status: number, body: string, setCookie?: string): void {
  const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'text/html; charset=utf-8' };
  if (setCookie) {
    headers['Set-Cookie'] = setCookie;
  }
  res.writeHead(status, headers);
  res.end(body);
}

function redirect(res: http.ServerResponse, location: string, setCookie?: string): void {
  const headers: http.OutgoingHttpHeaders = { Location: location };
  if (setCookie) {
    headers['Set-Cookie'] = setCookie;
  }
  res.writeHead(302, headers);
  res.end();
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Trust the first hop's forwarded address (Caddy) for rate-limit keying, else the socket. */
function clientIp(req: http.IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim();
  return first || req.socket.remoteAddress || 'unknown';
}

// ---- data assembly -------------------------------------------------------

async function overview(db: Db) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [users, activeMeters, readings, alerts24h, activeSubs] = await Promise.all([
    db.$count(schema.users),
    db.$count(schema.meters, eq(schema.meters.active, true)),
    db.$count(schema.readings),
    db.$count(schema.alertsLog, gte(schema.alertsLog.sentAt, dayAgo)),
    db.$count(schema.subscriptions, eq(schema.subscriptions.status, 'active')),
  ]);
  const [revenue] = await db
    .select({ total: sum(schema.payments.amountBdt) })
    .from(schema.payments);
  return {
    users,
    activeMeters,
    readings,
    alerts24h,
    activeSubscriptions: activeSubs,
    totalPaidBdt: Number(revenue?.total ?? 0),
  };
}

async function userList(db: Db, q: string, page: number) {
  const filters = [];
  if (q) {
    const ors = [ilike(schema.users.email, `%${q}%`)];
    if (/^\d+$/.test(q)) {
      ors.push(eq(schema.users.telegramChatId, Number(q)));
    }
    filters.push(or(...ors));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

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
    users: pageRows.map(u => ({
      id: u.id,
      telegramChatId: u.telegramChatId,
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
  const subscription = await subscriptions.activeFor(userId);
  const payments = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.userId, userId))
    .orderBy(desc(schema.payments.createdAt))
    .limit(PAYMENTS_SHOWN);

  return {
    user: {
      id: user.id,
      telegramChatId: user.telegramChatId,
      email: user.email,
      plan: user.plan,
      tonePref: user.tonePref,
      createdAt: user.createdAt.toISOString(),
    },
    limits: { maxMeters: maxMetersFor(user.plan), smsPerMonth: smsPerMonthFor(user.plan) },
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

async function pause(db: Db, userId: number): Promise<{ status: number; body: unknown }> {
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
  const { db, config, subscriptions, loginLimiter } = deps;
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
  const cookie = readCookie(req, ADMIN_COOKIE) ?? '';
  const authed = verifyAdminSession(cookie, secret);
  const method = req.method ?? 'GET';

  // --- auth pages & actions ---
  if (path === '/admin' && method === 'GET') {
    if (authed) {
      html(res, 200, adminAppHtml(csrfFor(cookie, secret)));
    } else {
      html(res, 200, adminLoginHtml(url.searchParams.has('error')));
    }
    return true;
  }

  if (path === '/admin/login' && method === 'POST') {
    if (!loginLimiter.allow(clientIp(req))) {
      html(res, 429, adminLoginHtml(true, 'Too many attempts. Wait a few minutes and try again.'));
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
    redirect(res, '/admin', sessionCookie('', secure, 0));
    return true;
  }

  // --- everything below is JSON API and requires a valid session ---
  if (path.startsWith('/admin/api/')) {
    if (!authed) {
      json(res, 401, { error: 'Not signed in.' });
      return true;
    }

    if (path === '/admin/api/overview' && method === 'GET') {
      json(res, 200, await overview(db));
      return true;
    }

    if (path === '/admin/api/users' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
      const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0') || 0);
      json(res, 200, await userList(db, q, page));
      return true;
    }

    const userMatch = /^\/admin\/api\/users\/(\d+)(?:\/(grant|pause|erase))?$/.exec(path);
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
        const csrfHeader = req.headers['x-csrf-token'];
        const csrf = Array.isArray(csrfHeader) ? csrfHeader[0] : (csrfHeader ?? '');
        if (!verifyCsrf(cookie, csrf, secret)) {
          json(res, 403, { error: 'Bad or missing CSRF token.' });
          return true;
        }
        const result =
          action === 'grant'
            ? await grant(db, subscriptions, userId, await readBody(req))
            : action === 'pause'
              ? await pause(db, userId)
              : await erase(db, userId);
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
