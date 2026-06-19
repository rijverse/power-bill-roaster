import http from 'http';
import { eq, and, sql } from 'drizzle-orm';
import { Db, schema } from '../db';
import { ServerConfig } from '../config';
import { Mailer } from '../services/mailer';
import { RateLimiter } from '../core/rate-limiter';
import { eraseUser } from '../core/erase-user';
import { sanitizeNickname } from '../core/sanitize';
import { maxMetersFor, smsPerMonthFor } from '../core/plans';
import { getProvider } from '../providers';
import { dashboardData } from './queries';
import { readCookie } from './admin-session';
import { appShellHtml, loginHtml } from './app-html';
import {
  USER_COOKIE,
  signMagicLink,
  verifyMagicLink,
  signUserSession,
  verifyUserSession,
  csrfFor,
  verifyCsrf,
  userCookie,
} from './user-auth';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_NICKNAME_LENGTH = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const METER_NO_RE = /^\d{5,20}$/;

export interface AppDeps {
  db: Db;
  config: ServerConfig;
  mailer: Mailer | null;
  /** magic-link email sends, keyed by email+ip */
  loginLimiter: RateLimiter;
  /** DESCO lookups on add-meter, keyed by user id */
  meterLimiter: RateLimiter;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function htmlPage(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
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

function clientIp(req: http.IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim();
  return first || req.socket.remoteAddress || 'unknown';
}

async function parseJson(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse((await readBody(req)) || '{}');
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ---- account / channel helpers -------------------------------------------

async function findOrCreateByEmail(db: Db, email: string): Promise<schema.User> {
  const lookup = () =>
    db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email}`);
  let [user] = await lookup();
  if (!user) {
    // onConflictDoNothing covers a race between two magic-link clicks for a
    // brand-new email (the lower(email) unique index makes it safe)
    await db.insert(schema.users).values({ email }).onConflictDoNothing();
    [user] = await lookup();
  }
  // make sure the verified, enabled email channel exists so alerts reach them
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.userId, user.id),
        eq(schema.channels.type, 'email'),
        eq(schema.channels.address, email)
      )
    );
  if (!channel) {
    await db
      .insert(schema.channels)
      .values({ userId: user.id, type: 'email', address: email, verified: true, enabled: true });
  } else if (!channel.verified || !channel.enabled) {
    await db
      .update(schema.channels)
      .set({ verified: true, enabled: true })
      .where(eq(schema.channels.id, channel.id));
  }
  return user;
}

async function ownedMeter(db: Db, userId: number, meterId: number): Promise<schema.Meter | null> {
  const [meter] = await db
    .select()
    .from(schema.meters)
    .where(and(eq(schema.meters.id, meterId), eq(schema.meters.userId, userId)));
  return meter ?? null;
}

// ---- account data + actions ----------------------------------------------

async function me(db: Db, userId: number) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return null;
  }
  const emailChannels = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.userId, userId), eq(schema.channels.type, 'email')));
  return {
    email: user.email,
    plan: user.plan,
    limits: { maxMeters: maxMetersFor(user.plan), smsPerMonth: smsPerMonthFor(user.plan) },
    emailAlerts: emailChannels.some(c => c.verified && c.enabled),
    ...(await dashboardData(db, userId)),
  };
}

async function addMeter(
  deps: AppDeps,
  userId: number,
  body: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const { db, config, meterLimiter } = deps;
  const accountNo = (typeof body.accountNo === 'string' ? body.accountNo : '').trim();
  const meterNo = (typeof body.meterNo === 'string' ? body.meterNo : '').trim();
  if (!METER_NO_RE.test(accountNo) || !METER_NO_RE.test(meterNo)) {
    return { status: 400, body: { error: 'Account and meter numbers should be 5-20 digits.' } };
  }

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return { status: 404, body: { error: 'No such account.' } };
  }
  const active = await db.$count(
    schema.meters,
    and(eq(schema.meters.userId, userId), eq(schema.meters.active, true))
  );
  if (active >= maxMetersFor(user.plan)) {
    return {
      status: 400,
      body: { error: `Your plan watches ${maxMetersFor(user.plan)} meter(s). That's the limit.` },
    };
  }
  if (!meterLimiter.allow(userId)) {
    return { status: 429, body: { error: 'Too many lookups. Give it a few minutes.' } };
  }

  let balance: number;
  try {
    const data = await getProvider('desco').getBalance({ accountNo, meterNo });
    balance = data.balance;
  } catch {
    return {
      status: 400,
      body: { error: "DESCO doesn't recognize that account/meter combo (or its API is down)." },
    };
  }

  const [existing] = await db
    .select()
    .from(schema.meters)
    .where(
      and(
        eq(schema.meters.userId, userId),
        eq(schema.meters.accountNo, accountNo),
        eq(schema.meters.meterNo, meterNo)
      )
    );
  if (existing) {
    await db.update(schema.meters).set({ active: true }).where(eq(schema.meters.id, existing.id));
  } else {
    await db.insert(schema.meters).values({
      userId,
      provider: 'desco',
      accountNo,
      meterNo,
      lowThreshold: config.defaultThresholds.low,
      criticalThreshold: config.defaultThresholds.critical,
    });
  }
  return { status: 200, body: { ok: true, balance } };
}

async function setThreshold(
  db: Db,
  meter: schema.Meter,
  body: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const low = Number(body.low);
  const critical = Number(body.critical);
  if (!Number.isFinite(low) || !Number.isFinite(critical) || critical >= low || critical < 0) {
    return { status: 400, body: { error: 'Critical must be below low, and both non-negative.' } };
  }
  await db
    .update(schema.meters)
    .set({ lowThreshold: low, criticalThreshold: critical })
    .where(eq(schema.meters.id, meter.id));
  return { status: 200, body: { ok: true } };
}

async function setNickname(
  db: Db,
  meter: schema.Meter,
  body: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const name = sanitizeNickname(typeof body.name === 'string' ? body.name : '');
  if (!name) {
    return { status: 400, body: { error: 'Letters and numbers, please.' } };
  }
  if (name.length > MAX_NICKNAME_LENGTH) {
    return { status: 400, body: { error: `Keep it under ${MAX_NICKNAME_LENGTH} characters.` } };
  }
  await db.update(schema.meters).set({ nickname: name }).where(eq(schema.meters.id, meter.id));
  return { status: 200, body: { ok: true } };
}

// ---- sign-in email --------------------------------------------------------

async function sendMagicLink(mailer: Mailer, baseUrl: string, email: string, token: string) {
  const link = `${baseUrl}/app/auth?token=${encodeURIComponent(token)}`;
  await mailer.send(
    email,
    'Your Power Roast sign-in link',
    `Tap to sign in (expires in 20 minutes):\n${link}\n\nIf you didn't request this, ignore it.`,
    `<!DOCTYPE html><html><body style="margin:0;background:#0d0d0d;font-family:'Segoe UI',system-ui,sans-serif;color:#eee">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0d0d0d"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#161616;border-radius:14px">
<tr><td style="padding:28px;text-align:center">
<h1 style="margin:0 0 8px;font-size:22px;color:#fff">⚡ Power <span style="color:#f59e0b">Roast</span></h1>
<p style="color:#aaa;font-size:14px;margin:0 0 24px">Tap to sign in. This link expires in 20 minutes.</p>
<a href="${link}" style="display:inline-block;background:#f59e0b;color:#111;text-decoration:none;padding:14px 32px;border-radius:999px;font-weight:700">Sign in</a>
<p style="color:#666;font-size:12px;margin:24px 0 0">If you didn't request this, just ignore it.</p>
</td></tr></table></td></tr></table></body></html>`
  );
}

// ---- router ---------------------------------------------------------------

/**
 * Owns every /app* route - the customer web app for people who don't use
 * Telegram. Returns true when it handled the request. Sign-in is passwordless
 * (emailed magic link); the session is a signed cookie. Requires SMTP to be
 * configured for sign-in; without it the API/session still work for anyone
 * already holding a cookie.
 */
export async function handleAppRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: AppDeps
): Promise<boolean> {
  const { db, config, mailer, loginLimiter } = deps;
  const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);
  const path = url.pathname;
  if (path !== '/app' && !path.startsWith('/app/')) {
    return false;
  }

  const secret = config.dashboardSecret;
  const secure = config.publicBaseUrl.startsWith('https');
  const cookie = readCookie(req, USER_COOKIE) ?? '';
  const userId = verifyUserSession(cookie, secret);
  const authed = userId !== null;
  const method = req.method ?? 'GET';
  const mailEnabled = mailer !== null;

  // --- auth pages & actions ---
  if (path === '/app' && method === 'GET') {
    if (authed) {
      htmlPage(res, 200, appShellHtml(csrfFor(cookie, secret)));
    } else {
      htmlPage(res, 200, loginHtml(mailEnabled, url.searchParams.get('status')));
    }
    return true;
  }

  if (path === '/app/login' && method === 'POST') {
    if (!mailEnabled) {
      redirect(res, '/app?status=disabled');
      return true;
    }
    const email = (new URLSearchParams(await readBody(req)).get('email') ?? '')
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(email)) {
      redirect(res, '/app?status=bademail');
      return true;
    }
    if (!loginLimiter.allow(`${email}|${clientIp(req)}`)) {
      redirect(res, '/app?status=ratelimited');
      return true;
    }
    try {
      await sendMagicLink(mailer, config.publicBaseUrl, email, signMagicLink(email, secret));
    } catch (error) {
      console.error('Magic-link send failed:', error);
      redirect(res, '/app?status=sendfailed');
      return true;
    }
    redirect(res, '/app?status=sent');
    return true;
  }

  if (path === '/app/auth' && method === 'GET') {
    const email = verifyMagicLink(url.searchParams.get('token') ?? '', secret);
    if (!email) {
      redirect(res, '/app?status=badlink');
      return true;
    }
    const user = await findOrCreateByEmail(db, email);
    redirect(res, '/app', userCookie(signUserSession(user.id, secret), secure));
    return true;
  }

  if (path === '/app/logout' && method === 'POST') {
    redirect(res, '/app', userCookie('', secure, 0));
    return true;
  }

  // --- JSON API (session required) ---
  if (path.startsWith('/app/api/')) {
    if (!authed) {
      json(res, 401, { error: 'Not signed in.' });
      return true;
    }

    if (path === '/app/api/me' && method === 'GET') {
      const data = await me(db, userId);
      if (!data) {
        json(res, 404, { error: 'Account not found.' });
      } else {
        json(res, 200, data);
      }
      return true;
    }

    // every mutation past here needs the CSRF token echoed from the page
    if (method === 'POST') {
      const header = req.headers['x-csrf-token'];
      const csrf = Array.isArray(header) ? header[0] : (header ?? '');
      if (!verifyCsrf(cookie, csrf, secret)) {
        json(res, 403, { error: 'Bad or missing CSRF token.' });
        return true;
      }
    }

    if (path === '/app/api/meters' && method === 'POST') {
      const body = await parseJson(req);
      if (!body) {
        json(res, 400, { error: 'Invalid body.' });
        return true;
      }
      const result = await addMeter(deps, userId, body);
      json(res, result.status, result.body);
      return true;
    }

    if (path === '/app/api/alerts/email' && method === 'POST') {
      const body = await parseJson(req);
      const enabled = body?.enabled === true;
      await db
        .update(schema.channels)
        .set({ enabled })
        .where(and(eq(schema.channels.userId, userId), eq(schema.channels.type, 'email')));
      json(res, 200, { ok: true, enabled });
      return true;
    }

    if (path === '/app/api/account/delete' && method === 'POST') {
      await eraseUser(db, userId);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': userCookie('', secure, 0),
      });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    const meterMatch = /^\/app\/api\/meters\/(\d+)\/(threshold|nickname|pause)$/.exec(path);
    if (meterMatch && method === 'POST') {
      const meter = await ownedMeter(db, userId, parseInt(meterMatch[1]));
      if (!meter) {
        json(res, 404, { error: 'No such meter.' });
        return true;
      }
      const action = meterMatch[2];
      if (action === 'pause') {
        await db.update(schema.meters).set({ active: false }).where(eq(schema.meters.id, meter.id));
        json(res, 200, { ok: true });
        return true;
      }
      const body = await parseJson(req);
      if (!body) {
        json(res, 400, { error: 'Invalid body.' });
        return true;
      }
      const result =
        action === 'threshold'
          ? await setThreshold(db, meter, body)
          : await setNickname(db, meter, body);
      json(res, result.status, result.body);
      return true;
    }

    json(res, 404, { error: 'Unknown endpoint.' });
    return true;
  }

  res.writeHead(404).end();
  return true;
}
