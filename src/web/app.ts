import http from 'http';
import { eq, and, ne, sql, desc } from 'drizzle-orm';
import { Db, schema } from '../db';
import { ServerConfig } from '../config';
import { Mailer } from '../services/mailer';
import { RateLimiter } from '../core/rate-limiter';
import { eraseUser } from '../core/erase-user';
import { sanitizeNickname } from '../core/sanitize';
import {
  maxMetersFor,
  smsPerMonthFor,
  priceBdtFor,
  isPurchasablePlan,
  PURCHASABLE_PLANS,
  billingLive,
} from '../core/plans';
import { Tone, normalizeTone, TONES } from '../core/tone';
import { setTone } from '../core/meter-usecases';
import { SubscriptionService } from '../billing';
import { getProvider } from '../providers';
import { connectDiscordWebhook } from '../core/discord-connect';
import { maskWebhookUrl } from '../logger';
import { dashboardData } from './queries';
import {
  clientIp,
  csrfHeader,
  html,
  isMutating,
  json,
  parseJson,
  readBody,
  redirect,
} from './http-utils';
import { readCookie } from './admin-session';
import { appShellHtml, loginHtml } from './app-html';
import {
  USER_COOKIE,
  signMagicLink,
  verifyMagicLink,
  magicCode,
  verifyMagicCode,
  signLinkToken,
  verifyLinkToken,
  signUserSession,
  verifyUserSession,
  csrfFor,
  verifyCsrf,
  userCookie,
} from './user-auth';

const MAX_NICKNAME_LENGTH = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const METER_NO_RE = /^\d{5,20}$/;

export interface AppDeps {
  db: Db;
  config: ServerConfig;
  mailer: Mailer | null;
  subscriptions: SubscriptionService;
  /** magic-link email sends, keyed by email+ip */
  loginLimiter: RateLimiter;
  /** DESCO lookups on add-meter, keyed by user id */
  meterLimiter: RateLimiter;
  /** per-request CSP nonce; inline <script> blocks must carry it to run */
  nonce: string;
}

const PLAN_NAMES: Record<string, string> = { free: 'Free', plus: 'Plus', business: 'Business' };

/** Plan catalogue (free + purchasable) for the billing screen. */
function planCatalog() {
  return ['free', ...PURCHASABLE_PLANS].map(id => ({
    id,
    name: PLAN_NAMES[id] ?? id,
    priceBdt: priceBdtFor(id),
    maxMeters: maxMetersFor(id),
    smsPerMonth: smsPerMonthFor(id),
  }));
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

/**
 * Attach an email to an existing (bot) account so the web app recognizes it as
 * the same user. Returns 'conflict' if the email already belongs to a different
 * account - we don't auto-merge on the email path; the user links from the web
 * side instead. On success returns the updated user with a verified email channel.
 */
export async function attachEmailToUser(
  db: Db,
  userId: number,
  email: string
): Promise<schema.User | 'conflict'> {
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`);
  if (existing && existing.id !== userId) {
    return 'conflict';
  }
  await db.update(schema.users).set({ email }).where(eq(schema.users.id, userId));
  // A replaced address must stop receiving alerts: the dispatcher fans out to
  // every enabled email row, so a stale-but-enabled row would keep leaking
  // balance mail to an address the user may no longer control. Disabled, not
  // deleted - alerts_log rows FK the channel, and re-adding re-enables it.
  await db
    .update(schema.channels)
    .set({ enabled: false })
    .where(
      and(
        eq(schema.channels.userId, userId),
        eq(schema.channels.type, 'email'),
        ne(schema.channels.address, email)
      )
    );
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.userId, userId),
        eq(schema.channels.type, 'email'),
        eq(schema.channels.address, email)
      )
    );
  if (!channel) {
    await db
      .insert(schema.channels)
      .values({ userId, type: 'email', address: email, verified: true, enabled: true });
  } else if (!channel.verified || !channel.enabled) {
    await db
      .update(schema.channels)
      .set({ verified: true, enabled: true })
      .where(eq(schema.channels.id, channel.id));
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
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

async function me(db: Db, userId: number, live = false) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return null;
  }
  const chans = await db.select().from(schema.channels).where(eq(schema.channels.userId, userId));
  // The row for the CURRENT address - after an email change the old address's
  // (disabled) row may still exist, and it must not speak for the toggle.
  const email = chans.find(
    c => c.type === 'email' && c.address.toLowerCase() === (user.email ?? '').toLowerCase()
  );
  const tg = chans.find(c => c.type === 'telegram');
  const sms = chans.find(c => c.type === 'sms' && c.verified);
  const discord = chans.find(c => c.type === 'discord' && c.verified);
  const emailAlerts = !!(email && email.verified && email.enabled);
  return {
    email: user.email,
    plan: user.plan,
    limits: { maxMeters: maxMetersFor(user.plan), smsPerMonth: smsPerMonthFor(user.plan) },
    tone: normalizeTone(user.tonePref),
    quietStart: user.quietStart,
    quietEnd: user.quietEnd,
    emailAlerts,
    channels: {
      email: { address: user.email, verified: !!(email && email.verified), enabled: emailAlerts },
      telegram: {
        available: user.telegramChatId !== null,
        enabled: !tg || tg.enabled,
        // filled in by the /app/api/me route when a connect link is available
        connectUrl: null as string | null,
      },
      sms: {
        available: smsPerMonthFor(user.plan) > 0,
        hasPhone: !!sms,
        enabled: !!(sms && sms.enabled),
        address: sms?.address ?? null,
      },
      // Discord is free for everyone; only the masked URL is ever sent to the client.
      discord: {
        connected: !!discord,
        enabled: !!(discord && discord.enabled),
        address: discord ? maskWebhookUrl(discord.address) : null,
      },
    },
    billingLive: live,
    ...(await dashboardData(db, userId)),
  };
}

/** Persist roast tone + quiet hours from the Alerts screen. */
async function setSettings(
  db: Db,
  userId: number,
  body: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  // Tone goes through the core use-case (the sole writer of tone_pref); quiet
  // hours are web-only, so they stay here.
  let tone: Tone | undefined;
  if (body.tone !== undefined) {
    if (typeof body.tone !== 'string' || !TONES.includes(body.tone as never)) {
      return { status: 400, body: { error: 'Tone must be savage or mild.' } };
    }
    tone = normalizeTone(body.tone);
  }
  const patch: { quietStart?: number | null; quietEnd?: number | null } = {};
  if (body.quietStart !== undefined || body.quietEnd !== undefined) {
    const start = body.quietStart;
    const end = body.quietEnd;
    const off = start === null && end === null;
    const valid = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
    if (!off && (!valid(start) || !valid(end))) {
      return {
        status: 400,
        body: { error: 'Quiet hours must be whole hours 0-23, or both null.' },
      };
    }
    patch.quietStart = off ? null : (start as number);
    patch.quietEnd = off ? null : (end as number);
  }
  if (tone === undefined && Object.keys(patch).length === 0) {
    return { status: 400, body: { error: 'Nothing to update.' } };
  }
  if (tone !== undefined) {
    await setTone(db, userId, tone);
  }
  if (Object.keys(patch).length > 0) {
    await db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
  }
  return { status: 200, body: { ok: true } };
}

/** Enable/disable an alert channel (email | telegram | sms | discord) for a user. */
async function setChannel(
  db: Db,
  user: schema.User,
  type: 'email' | 'telegram' | 'sms' | 'discord',
  enabled: boolean
): Promise<{ status: number; body: unknown }> {
  if (type === 'telegram') {
    if (user.telegramChatId === null) {
      return {
        status: 400,
        body: { error: 'No Telegram account linked. Open the bot and /start.' },
      };
    }
    const [existing] = await db
      .select()
      .from(schema.channels)
      .where(and(eq(schema.channels.userId, user.id), eq(schema.channels.type, 'telegram')));
    if (existing) {
      await db.update(schema.channels).set({ enabled }).where(eq(schema.channels.id, existing.id));
    } else {
      await db.insert(schema.channels).values({
        userId: user.id,
        type: 'telegram',
        address: String(user.telegramChatId),
        verified: true,
        enabled,
      });
    }
    return { status: 200, body: { ok: true, enabled } };
  }
  // email / sms: only a verified channel can be toggled (you can't enable alerts
  // to an address you never confirmed). SMS numbers are added via the bot's /sms.
  // For email, pin the toggle to the CURRENT address - a superseded address's
  // row may linger (disabled) after an email change and must never be the one
  // this flips.
  const rows = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.userId, user.id),
        eq(schema.channels.type, type),
        eq(schema.channels.verified, true)
      )
    );
  const channel =
    type === 'email'
      ? rows.find(c => c.address.toLowerCase() === (user.email ?? '').toLowerCase())
      : rows[0];
  if (!channel) {
    const hint =
      type === 'sms'
        ? 'Add a phone number first with the bot: /sms <number>.'
        : type === 'discord'
          ? 'Connect a Discord webhook first.'
          : 'No verified email on file.';
    return { status: 400, body: { error: hint } };
  }
  await db.update(schema.channels).set({ enabled }).where(eq(schema.channels.id, channel.id));
  return { status: 200, body: { ok: true, enabled } };
}

/** Save (or replace) a user's Discord webhook; the mechanism is shared with both bots. */
async function setDiscordWebhook(
  db: Db,
  user: schema.User,
  url: unknown
): Promise<{ status: number; body: unknown }> {
  const result = await connectDiscordWebhook(db, user.id, url);
  if (!result.ok) {
    return {
      status: 400,
      body: {
        error:
          result.reason === 'invalid-url'
            ? "That doesn't look like a Discord webhook URL."
            : "Couldn't post to that webhook - check the URL is current and try again.",
      },
    };
  }
  return { status: 200, body: { ok: true, address: maskWebhookUrl(result.address) } };
}

// ---- billing --------------------------------------------------------------

async function billing(db: Db, subscriptions: SubscriptionService, userId: number, live: boolean) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return null;
  }
  const subscription = await subscriptions.activeFor(userId);
  const payments = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.userId, userId))
    .orderBy(desc(schema.payments.createdAt))
    .limit(20);
  return {
    live,
    plan: user.plan,
    priceBdt: priceBdtFor(user.plan),
    limits: { maxMeters: maxMetersFor(user.plan), smsPerMonth: smsPerMonthFor(user.plan) },
    catalog: planCatalog(),
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

/** Start a plan upgrade. Mirrors the bot's /upgrade: returns a redirect URL for
 * real providers, or activates immediately for the auto-confirming sandbox. */
async function checkout(
  deps: AppDeps,
  userId: number,
  body: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const { db, subscriptions, config } = deps;
  if (!billingLive(config.billing)) {
    return { status: 400, body: { error: "Paid plans aren't switched on yet." } };
  }
  const plan = typeof body.plan === 'string' ? body.plan : '';
  if (!isPurchasablePlan(plan)) {
    return { status: 400, body: { error: 'Unknown plan.' } };
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return { status: 404, body: { error: 'No such account.' } };
  }
  if (user.plan === plan) {
    return { status: 400, body: { error: `You're already on ${plan}.` } };
  }
  try {
    const result = await subscriptions.startUpgrade(user, plan);
    return { status: 200, body: { ...result, plan } };
  } catch (error) {
    console.error('Checkout failed:', error);
    return { status: 502, body: { error: "Couldn't start checkout. Try again in a bit." } };
  }
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

export async function sendMagicLink(
  mailer: Mailer,
  baseUrl: string,
  email: string,
  token: string,
  code: string,
  attachLinkToken?: string
) {
  const link =
    `${baseUrl}/app/auth?token=${encodeURIComponent(token)}` +
    (attachLinkToken ? `&link=${encodeURIComponent(attachLinkToken)}` : '');
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  await mailer.send(
    email,
    'Your Power Roast sign-in link',
    `Tap to sign in (expires in 20 minutes):\n${link}\n\nOn the device you started from, you can enter this code instead: ${spaced}\n\nIf you didn't request this, ignore it.`,
    `<!DOCTYPE html><html><body style="margin:0;background:#14110C;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#A79D8C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#14110C"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#1E1A14;border-radius:4px;border:1.5px solid #3A3126">
<tr><td style="padding:32px;text-align:center">
<h1 style="margin:0 0 8px;font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#F5F1EA">⚡ Power<span style="color:#FBB024">·Roast</span></h1>
<p style="color:#A79D8C;font-size:14px;line-height:1.55;margin:0 0 24px">Tap to sign in. This link expires in 20 minutes.</p>
<a href="${link}" style="display:inline-block;background:#FBB024;color:#1A1408;text-decoration:none;padding:14px 34px;border-radius:3px;font-weight:700">Sign in &amp; brace yourself</a>
<p style="color:#A79D8C;font-size:13px;line-height:1.55;margin:24px 0 0">On the device you started from, you can enter this code instead:</p>
<div style="font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:700;letter-spacing:0.15em;color:#F5F1EA;margin:6px 0 0">${spaced}</div>
<p style="color:#837A68;font-size:12px;margin:24px 0 0">If you didn't request this, just ignore it.</p>
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
  const { db, config, mailer, loginLimiter, nonce } = deps;
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
      html(res, 200, appShellHtml(nonce, csrfFor(cookie, secret), config.rechargeUrl));
    } else {
      html(res, 200, loginHtml(nonce, mailEnabled, url.searchParams.get('status')));
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
      await sendMagicLink(
        mailer,
        config.publicBaseUrl,
        email,
        signMagicLink(email, secret),
        magicCode(email, secret)
      );
    } catch (error) {
      console.error('Magic-link send failed:', error);
      redirect(res, '/app?status=sendfailed');
      return true;
    }
    redirect(res, '/app?status=sent');
    return true;
  }

  // Code fallback: enter the 6-digit code from the email on the device you
  // started from (mail apps often open the link in a different browser).
  if (path === '/app/login/code' && method === 'POST') {
    if (!mailEnabled) {
      redirect(res, '/app?status=disabled');
      return true;
    }
    const form = new URLSearchParams(await readBody(req));
    const email = (form.get('email') ?? '').trim().toLowerCase();
    const code = (form.get('code') ?? '').replace(/\D/g, '');
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
      redirect(res, '/app?status=badcode');
      return true;
    }
    if (!loginLimiter.allow(`${email}|${clientIp(req)}`)) {
      redirect(res, '/app?status=ratelimited');
      return true;
    }
    if (!verifyMagicCode(email, code, secret)) {
      redirect(res, '/app?status=badcode');
      return true;
    }
    const user = await findOrCreateByEmail(db, email);
    redirect(res, '/app', userCookie(signUserSession(user.id, secret), secure));
    return true;
  }

  if (path === '/app/auth' && method === 'GET') {
    const email = verifyMagicLink(url.searchParams.get('token') ?? '', secret);
    if (!email) {
      redirect(res, '/app?status=badlink');
      return true;
    }
    // A `link` param (from the bot's /email flow) attaches this email to an
    // existing bot account instead of creating a fresh one - unless the email
    // already belongs to someone else, in which case we send them to link from
    // the web side (we never auto-merge on the email path).
    const linkParam = url.searchParams.get('link');
    const attachUserId = linkParam ? verifyLinkToken(linkParam, secret) : null;
    let user: schema.User;
    if (attachUserId !== null) {
      const attached = await attachEmailToUser(db, attachUserId, email);
      if (attached === 'conflict') {
        redirect(res, '/app?status=emailtaken');
        return true;
      }
      user = attached;
    } else {
      user = await findOrCreateByEmail(db, email);
    }
    redirect(res, '/app', userCookie(signUserSession(user.id, secret), secure));
    return true;
  }

  if (path === '/app/logout' && method === 'POST') {
    // Plain form POST, so the token is in the body rather than the header the
    // API routes echo. Sits above the /app/api/ choke point, so it needs its own.
    const csrf = new URLSearchParams(await readBody(req)).get('csrf') ?? '';
    if (!verifyCsrf(cookie, csrf, secret)) {
      redirect(res, '/app');
      return true;
    }
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
      const data = await me(db, userId, billingLive(config.billing));
      if (!data) {
        json(res, 404, { error: 'Account not found.' });
      } else {
        // Offer a "Connect Telegram" deep link when the account has no Telegram
        // yet and we know the bot's username. The token links this web user to
        // whichever chat taps it (bot side handles the linking / merge).
        if (!data.channels.telegram.available && config.botUsername) {
          const token = signLinkToken(userId, secret);
          data.channels.telegram.connectUrl = `https://t.me/${config.botUsername}?start=link_${token}`;
        }
        json(res, 200, data);
      }
      return true;
    }

    if (path === '/app/api/billing' && method === 'GET') {
      const data = await billing(db, deps.subscriptions, userId, billingLive(config.billing));
      if (!data) {
        json(res, 404, { error: 'Account not found.' });
      } else {
        json(res, 200, data);
      }
      return true;
    }

    // Every mutation past here needs the CSRF token echoed from the page. Gated
    // on the method rather than on POST specifically, so a future PUT/PATCH/
    // DELETE route can't ship unprotected just by being forgotten here.
    if (isMutating(method) && !verifyCsrf(cookie, csrfHeader(req), secret)) {
      json(res, 403, { error: 'Bad or missing CSRF token.' });
      return true;
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

    if (path === '/app/api/settings' && method === 'POST') {
      const body = await parseJson(req);
      if (!body) {
        json(res, 400, { error: 'Invalid body.' });
        return true;
      }
      const result = await setSettings(db, userId, body);
      json(res, result.status, result.body);
      return true;
    }

    const chanMatch = /^\/app\/api\/alerts\/(email|telegram|sms|discord)$/.exec(path);
    if (chanMatch && method === 'POST') {
      const body = await parseJson(req);
      const enabled = body?.enabled === true;
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      if (!user) {
        json(res, 404, { error: 'Account not found.' });
        return true;
      }
      const result = await setChannel(
        db,
        user,
        chanMatch[1] as 'email' | 'telegram' | 'sms' | 'discord',
        enabled
      );
      json(res, result.status, result.body);
      return true;
    }

    if (path === '/app/api/discord' && method === 'POST') {
      const body = await parseJson(req);
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      if (!user) {
        json(res, 404, { error: 'Account not found.' });
        return true;
      }
      const result = await setDiscordWebhook(db, user, body?.url);
      json(res, result.status, result.body);
      return true;
    }

    if (path === '/app/api/checkout' && method === 'POST') {
      const body = await parseJson(req);
      if (!body) {
        json(res, 400, { error: 'Invalid body.' });
        return true;
      }
      const result = await checkout(deps, userId, body);
      json(res, result.status, result.body);
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
