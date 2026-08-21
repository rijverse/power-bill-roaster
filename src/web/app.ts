import http from 'http';
import { eq, and, desc } from 'drizzle-orm';
import { Db, schema } from '../db';
import { ServerConfig } from '../config';
import { Mailer } from '../services/mailer';
import { RateLimiter } from '../core/rate-limiter';
import { eraseUser } from '../core/erase-user';
import { sanitizeNickname } from '../core/sanitize';
import {
  maxMetersFor,
  effectiveMeterLimit,
  smsPerMonthFor,
  priceBdtFor,
  isPurchasablePlan,
  PURCHASABLE_PLANS,
  billingLive,
} from '../core/plans';
import { Tone, normalizeTone, TONES } from '../core/tone';
import { setTone, atMeterCap, activeMeters } from '../core/meter-usecases';
import { recordReading, readingFromBalance } from '../core/meter-reading';
import { plural } from '../core/plural';
import {
  linkIdentity,
  unlinkIdentity,
  findUserByProvider,
  contactTargets,
} from '../core/identities';
import { mergeAccounts, chooseSurvivor } from '../core/merge-accounts';
import { SubscriptionService } from '../billing';
import { getProvider } from '../providers';
import { connectDiscordWebhook } from '../core/discord-connect';
import { logger, maskWebhookUrl } from '../logger';
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
import { appShellHtml, loginHtml, mergeConfirmHtml, MergeAccount } from './app-html';
import {
  userCookieName,
  emailHintCookie,
  clearEmailHintCookie,
  emailHintCookieName,
  readEmailHint,
  signMagicLink,
  verifyMagicLink,
  magicCode,
  verifyMagicCode,
  signLinkToken,
  verifyLinkToken,
  verifyDiscordLinkToken,
  signWhatsAppConnectToken,
  signMergeToken,
  verifyMergeToken,
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
  /** sign-in attempts for one address, keyed by email alone - no IP to rotate.
   *  Sends and code guesses get separate budgets off the same instance. */
  emailLimiter: RateLimiter;
  /** aggregate sign-in cap across every address, the IP-rotation backstop */
  loginGlobalLimiter: RateLimiter;
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
  const existing = await findUserByProvider(db, 'email', email.toLowerCase());
  if (existing) {
    // Idempotently ensure the verified, enabled email channel is present.
    await linkIdentity(
      db,
      existing.id,
      { provider: 'email', email },
      { replaceSameProvider: true }
    );
    return existing;
  }
  // New address: create a bare account and attach the email identity + channel.
  const [created] = await db.insert(schema.users).values({}).returning();
  const result = await linkIdentity(db, created.id, { provider: 'email', email });
  if (result.status === 'needs-merge') {
    // Lost a race to another magic-link click for the same address: drop the
    // stray bare account and use the one that won the identity (unique index).
    await db.delete(schema.users).where(eq(schema.users.id, created.id));
    return (await findUserByProvider(db, 'email', email.toLowerCase()))!;
  }
  return created;
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
  // linkIdentity is the one write path: it sets the email identity, retires any
  // stale email channel (a replaced address must stop receiving alerts - the
  // dispatcher fans out to every enabled email row), and leaves a verified,
  // enabled channel for this address. replaceSameProvider because changing the
  // address on an account is the point of this function. A 'needs-merge' means
  // another account already holds the address - reported as a conflict, since we
  // never auto-merge on the email path.
  const result = await linkIdentity(
    db,
    userId,
    { provider: 'email', email },
    { replaceSameProvider: true }
  );
  if (result.status === 'needs-merge') {
    return 'conflict';
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  return user;
}

/** Meter count, plan, and a human label for one side of a merge-confirm screen. */
async function mergeSummary(
  db: Db,
  userId: number
): Promise<(MergeAccount & { userId: number }) | null> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) {
    return null;
  }
  const meters = await db
    .select({ id: schema.meters.id })
    .from(schema.meters)
    .where(eq(schema.meters.userId, userId));
  const t = await contactTargets(db, userId);
  const label =
    t.email ??
    (t.telegramChatId !== null
      ? 'Telegram account'
      : t.discordUserId !== null
        ? 'Discord account'
        : `Account #${userId}`);
  return { userId, label, meterCount: meters.length, planName: PLAN_NAMES[u.plan] ?? u.plan };
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
  const targets = await contactTargets(db, userId);
  // The row for the CURRENT address - after an email change the old address's
  // (disabled) row may still exist, and it must not speak for the toggle. The
  // login email lives on the identity (lower-cased); the channel keeps the
  // address as typed, which is what we display.
  const emailChan = chans.find(
    c => c.type === 'email' && targets.email !== null && c.address.toLowerCase() === targets.email
  );
  const displayEmail = emailChan?.address ?? targets.email;
  const tg = chans.find(c => c.type === 'telegram');
  const sms = chans.find(c => c.type === 'sms' && c.verified);
  const discord = chans.find(c => c.type === 'discord' && c.verified);
  const whatsapp = chans.find(c => c.type === 'whatsapp' && c.verified);
  const emailAlerts = !!(emailChan && emailChan.verified && emailChan.enabled);
  return {
    email: displayEmail,
    plan: user.plan,
    limits: { maxMeters: effectiveMeterLimit(user), smsPerMonth: smsPerMonthFor(user.plan) },
    tone: normalizeTone(user.tonePref),
    quietStart: user.quietStart,
    quietEnd: user.quietEnd,
    emailAlerts,
    channels: {
      email: {
        address: displayEmail,
        verified: !!(emailChan && emailChan.verified),
        enabled: emailAlerts,
      },
      telegram: {
        available: targets.telegramChatId !== null,
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
      whatsapp: {
        available: !!whatsapp,
        enabled: !!(whatsapp && whatsapp.enabled),
        // filled in by the /app/api/me route when WhatsApp is configured
        connectUrl: null as string | null,
      },
    },
    // Which sign-in identities this account holds. Drives the disconnect controls;
    // the last one can't be removed (unlinkIdentity refuses it), so the client
    // only offers disconnect when more than one is present.
    logins: {
      telegram: targets.telegramChatId !== null,
      discord: targets.discordUserId !== null,
      email: targets.email !== null,
    },
    // "Get the bot" links (install / open the app on the user's side), filled in
    // by the /app/api/me route from config. Null when that platform is off.
    apps: {
      telegram: null as string | null,
      discord: null as string | null,
      whatsapp: null as string | null,
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
  const targets = await contactTargets(db, user.id);
  if (type === 'telegram') {
    if (targets.telegramChatId === null) {
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
        address: String(targets.telegramChatId),
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
      ? rows.find(c => targets.email !== null && c.address.toLowerCase() === targets.email)
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
    limits: { maxMeters: effectiveMeterLimit(user), smsPerMonth: smsPerMonthFor(user.plan) },
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
    logger.error('Checkout failed', error);
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
  if (await atMeterCap(db, user)) {
    const limit = effectiveMeterLimit(user);
    return {
      status: 400,
      body: {
        error: `Your plan watches ${plural(limit, 'meter')}. That's the limit.`,
      },
    };
  }
  if (!meterLimiter.allow(userId)) {
    return { status: 429, body: { error: 'Too many lookups. Give it a few minutes.' } };
  }

  let data;
  try {
    data = await getProvider('desco').getBalance({ accountNo, meterNo });
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
  let meter: schema.Meter;
  if (existing) {
    [meter] = await db
      .update(schema.meters)
      .set({ active: true })
      .where(eq(schema.meters.id, existing.id))
      .returning();
  } else {
    [meter] = await db
      .insert(schema.meters)
      .values({
        userId,
        provider: 'desco',
        accountNo,
        meterNo,
        lowThreshold: config.defaultThresholds.low,
        criticalThreshold: config.defaultThresholds.critical,
      })
      .returning();
  }

  // Keep the balance we just fetched: without this the meter has no reading
  // until the next poll cycle (6h by default), so the dashboard shows ৳0.00
  // and "every meter is healthy" for a meter that may already be critical -
  // and the first alert waits out the same six hours.
  await recordReading(db, meter, userId, readingFromBalance(data), {
    reminderIntervalMs: config.reminderIntervalHours * 60 * 60 * 1000,
    rechargeUrl: config.rechargeUrl,
  });
  return { status: 200, body: { ok: true, balance: data.balance } };
}

/**
 * Re-read every active meter from the provider. This is what the dashboard's
 * force-check button calls: it used to only re-render from the database, which
 * meant a user had no way to see a fresh balance between poll cycles.
 */
async function refreshMeters(
  deps: AppDeps,
  userId: number
): Promise<{ status: number; body: unknown }> {
  const { db, config, meterLimiter } = deps;
  if (!meterLimiter.allow(userId)) {
    return { status: 429, body: { error: 'Too many checks. Give it a few minutes.' } };
  }
  const meters = await activeMeters(db, userId);
  if (meters.length === 0) {
    return { status: 200, body: { ok: true, checked: 0, failed: 0 } };
  }
  let failed = 0;
  for (const meter of meters) {
    try {
      const data = await getProvider(meter.provider).getBalance({
        accountNo: meter.accountNo,
        meterNo: meter.meterNo,
      });
      await recordReading(db, meter, userId, readingFromBalance(data), {
        reminderIntervalMs: config.reminderIntervalHours * 60 * 60 * 1000,
        rechargeUrl: config.rechargeUrl,
      });
    } catch (error) {
      failed++;
      logger.warn(`Force check failed for meter ${meter.id}`, error);
    }
  }
  if (failed === meters.length) {
    return { status: 502, body: { error: "Couldn't reach DESCO just now. Try again shortly." } };
  }
  return { status: 200, body: { ok: true, checked: meters.length - failed, failed } };
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
  const { db, config, mailer, loginLimiter, emailLimiter, loginGlobalLimiter, nonce } = deps;
  const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);
  const path = url.pathname;
  if (path !== '/app' && !path.startsWith('/app/')) {
    return false;
  }

  const secret = config.dashboardSecret;
  const secure = config.publicBaseUrl.startsWith('https');
  const cookie = readCookie(req, userCookieName(secure)) ?? '';
  const userId = verifyUserSession(cookie, secret);
  const authed = userId !== null;
  const method = req.method ?? 'GET';
  const mailEnabled = mailer !== null;

  // --- auth pages & actions ---
  if (path === '/app' && method === 'GET') {
    if (authed) {
      html(res, 200, appShellHtml(nonce, csrfFor(cookie, secret), config.rechargeUrl));
    } else {
      html(
        res,
        200,
        loginHtml(
          nonce,
          mailEnabled,
          url.searchParams.get('status'),
          readEmailHint(readCookie(req, emailHintCookieName(secure))),
          config.botUsername ? `https://t.me/${config.botUsername}` : null
        )
      );
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
    if (!loginLimiter.allow(`${email}|${clientIp(req)}`) || !emailLimiter.allow(`send:${email}`)) {
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
      logger.error('Magic-link send failed', error);
      redirect(res, '/app?status=sendfailed');
      return true;
    }
    redirect(res, '/app?status=sent', emailHintCookie(email, secure));
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
    // The email-keyed and global limiters are what actually bound a guesser: the
    // code is derived from (email, time bucket) so it can be attacked without the
    // owner ever asking for one, and the IP half of the first key is worth
    // nothing against someone rotating addresses.
    if (
      !loginLimiter.allow(`${email}|${clientIp(req)}`) ||
      !emailLimiter.allow(`code:${email}`) ||
      !loginGlobalLimiter.allow('app-login')
    ) {
      redirect(res, '/app?status=ratelimited');
      return true;
    }
    if (!verifyMagicCode(email, code, secret)) {
      redirect(res, '/app?status=badcode');
      return true;
    }
    const user = await findOrCreateByEmail(db, email);
    redirect(res, '/app', [
      userCookie(signUserSession(user.id, secret), secure),
      clearEmailHintCookie(secure),
    ]);
    return true;
  }

  if (path === '/app/auth' && method === 'GET') {
    const email = verifyMagicLink(url.searchParams.get('token') ?? '', secret);
    if (!email) {
      redirect(res, '/app?status=badlink');
      return true;
    }
    // A `link` param (from the bot's /email flow) attaches this email to an
    // existing bot account instead of creating a fresh one. If the email already
    // belongs to someone else, the magic link just proved control of that email
    // and the link token proved the bot account, so offer to combine the two:
    // sign into the email's account and send to the merge-confirm screen.
    const linkParam = url.searchParams.get('link');
    const attachUserId = linkParam ? verifyLinkToken(linkParam, secret) : null;
    let user: schema.User;
    if (attachUserId !== null) {
      const attached = await attachEmailToUser(db, attachUserId, email);
      if (attached === 'conflict') {
        const owner = await findUserByProvider(db, 'email', email);
        if (owner && owner.id !== attachUserId) {
          const token = signMergeToken(owner.id, attachUserId, secret);
          redirect(
            res,
            `/app/merge?token=${token}`,
            userCookie(signUserSession(owner.id, secret), secure)
          );
          return true;
        }
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

  // Discord connect: the Discord bot's /connect hands the user this link with a
  // signed token carrying their Discord id. They must be signed in on the web,
  // and we attach that Discord id to the signed-in account (folding in a legacy
  // Discord-only account if one exists). Discord has no ?start= deep link, so the
  // flow runs this direction rather than the Telegram-style web-to-bot one.
  if (path === '/app/connect/discord' && method === 'GET') {
    if (!authed) {
      redirect(res, '/app?status=signin-to-connect');
      return true;
    }
    const discordUserId = verifyDiscordLinkToken(url.searchParams.get('token') ?? '', secret);
    if (!discordUserId) {
      redirect(res, '/app?status=badlink');
      return true;
    }
    const result = await linkIdentity(db, userId, { provider: 'discord', discordUserId });
    if (result.status === 'provider-conflict') {
      redirect(res, '/app?status=discord-conflict');
      return true;
    }
    if (result.status === 'needs-merge') {
      // The Discord id already belongs to another (legacy) account. Don't merge
      // silently - hand the user a confirmation screen. The signed-in account is
      // the preferred survivor on a tie; the merge itself runs on the POST there.
      const token = signMergeToken(userId, result.otherUserId, secret);
      redirect(res, `/app/merge?token=${token}`);
      return true;
    }
    redirect(res, '/app?status=discord-connected');
    return true;
  }

  // Confirm-then-merge two accounts. The GET only renders the summary; the merge
  // runs on the POST (CSRF in the body, like /app/logout), so the link is safe to
  // hand out and can't combine accounts on a single click. The token names both
  // sides and the session must be one of them - it's minted only after the server
  // has established the requester controls both.
  if (path === '/app/merge' && method === 'GET') {
    if (!authed) {
      redirect(res, '/app?status=signin-to-connect');
      return true;
    }
    const raw = url.searchParams.get('token') ?? '';
    const pair = verifyMergeToken(raw, secret);
    if (!pair || (userId !== pair.a && userId !== pair.b)) {
      redirect(res, '/app?status=badlink');
      return true;
    }
    const a = await mergeSummary(db, pair.a);
    const b = await mergeSummary(db, pair.b);
    if (!a || !b) {
      // One side was already merged away or erased since the token was minted.
      redirect(res, '/app?status=merge-gone');
      return true;
    }
    html(res, 200, mergeConfirmHtml(csrfFor(cookie, secret), raw, a, b));
    return true;
  }

  if (path === '/app/merge' && method === 'POST') {
    if (!authed) {
      redirect(res, '/app');
      return true;
    }
    const form = new URLSearchParams(await readBody(req));
    if (!verifyCsrf(cookie, form.get('csrf') ?? '', secret)) {
      redirect(res, '/app');
      return true;
    }
    const pair = verifyMergeToken(form.get('token') ?? '', secret);
    if (!pair || (userId !== pair.a && userId !== pair.b)) {
      redirect(res, '/app?status=badlink');
      return true;
    }
    // `a` is the preferred survivor on a tie; a live paid plan still wins outright.
    const aHasSub = (await deps.subscriptions.activeFor(pair.a)) !== null;
    const bHasSub = (await deps.subscriptions.activeFor(pair.b)) !== null;
    const { survivorId, loserId } = chooseSurvivor(
      { id: pair.a, hasSubscription: aHasSub },
      { id: pair.b, hasSubscription: bHasSub }
    );
    const merged = await mergeAccounts(db, survivorId, loserId);
    if (merged !== 'merged') {
      redirect(res, '/app?status=merge-gone');
      return true;
    }
    // The loser row is gone; keep the session on whichever account survived.
    if (userId === loserId) {
      redirect(res, '/app?status=merged', userCookie(signUserSession(survivorId, secret), secure));
      return true;
    }
    redirect(res, '/app?status=merged');
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
        // WhatsApp connects the other way: hand out a wa.me link with a signed
        // token prefilled, which the inbound webhook reads back to attach the
        // sender's number. Only when WhatsApp is configured and not yet linked.
        if (config.whatsapp && !data.channels.whatsapp.available) {
          const token = signWhatsAppConnectToken(userId, secret);
          const text = encodeURIComponent(`connect ${token}`);
          data.channels.whatsapp.connectUrl = `https://wa.me/${config.whatsapp.displayNumber}?text=${text}`;
        }
        // "Get the bot" links: add/open each app on the user's side, so they can
        // then run /connect, /balance, etc. Shown only for configured platforms.
        data.apps = {
          telegram: config.botUsername ? `https://t.me/${config.botUsername}` : null,
          discord: config.discord
            ? `https://discord.com/oauth2/authorize?client_id=${config.discord.appId}&scope=${encodeURIComponent('bot applications.commands')}`
            : null,
          whatsapp: config.whatsapp ? `https://wa.me/${config.whatsapp.displayNumber}` : null,
        };
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

    if (path === '/app/api/refresh' && method === 'POST') {
      const result = await refreshMeters(deps, userId);
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

    // Disconnect a sign-in identity (telegram / discord / email) from this
    // account. Refuses the last one so the account can't be orphaned, and turns
    // off that provider's alert channel on the way out.
    if (path === '/app/api/identities/disconnect' && method === 'POST') {
      const body = await parseJson(req);
      const provider = (body as { provider?: unknown } | null)?.provider;
      if (provider !== 'telegram' && provider !== 'discord' && provider !== 'email') {
        json(res, 400, { error: 'Unknown sign-in method.' });
        return true;
      }
      const result = await unlinkIdentity(db, userId, provider);
      if (result.status === 'last-identity') {
        json(res, 400, {
          error: "That's your only way in - connect another sign-in method first.",
        });
        return true;
      }
      if (result.status === 'not-found') {
        json(res, 400, { error: 'That sign-in method is not connected.' });
        return true;
      }
      json(res, 200, { ok: true });
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

    const meterMatch = /^\/app\/api\/meters\/(\d+)\/(threshold|nickname|pause|resume)$/.exec(path);
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
      if (action === 'resume') {
        const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
        // resuming counts against the cap like adding one would, otherwise
        // pause/resume is a way around it
        if (user && (await atMeterCap(db, user))) {
          json(res, 400, {
            error: `Your plan watches ${plural(effectiveMeterLimit(user), 'meter')}. Pause another one first.`,
          });
          return true;
        }
        await db.update(schema.meters).set({ active: true }).where(eq(schema.meters.id, meter.id));
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
