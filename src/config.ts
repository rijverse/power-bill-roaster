import 'dotenv/config';
import crypto from 'crypto';
import { isValidDiscordWebhookUrl } from './notifications/discord';
import { DEFAULT_RECHARGE_URL } from './core/recharge';
import { Tone, normalizeTone } from './core/tone';

/** Parse an integer env var, falling back when unset/blank. Rejects NaN and
 *  optionally enforces a min or strict positivity, so a typo like
 *  LOW_THRESHOLD=abc can't silently turn every threshold comparison false. */
function parseIntEnv(
  name: string,
  raw: string | undefined,
  fallback: number,
  opts: { min?: number; positive?: boolean } = {}
): number {
  const n = raw && raw.trim() !== '' ? parseInt(raw, 10) : fallback;
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a finite integer (got "${raw ?? ''}")`);
  }
  if (opts.positive && n <= 0) {
    throw new Error(`${name} must be greater than 0 (got ${n})`);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new Error(`${name} must be >= ${opts.min} (got ${n})`);
  }
  return n;
}

/** Parse a float env var with the same guards as parseIntEnv. */
function parseFloatEnv(
  name: string,
  raw: string | undefined,
  fallback: number,
  opts: { min?: number; positive?: boolean } = {}
): number {
  const n = raw && raw.trim() !== '' ? parseFloat(raw) : fallback;
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a finite number (got "${raw ?? ''}")`);
  }
  if (opts.positive && n <= 0) {
    throw new Error(`${name} must be greater than 0 (got ${n})`);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new Error(`${name} must be >= ${opts.min} (got ${n})`);
  }
  return n;
}

/** Parse an integer env var that is optional (null when unset/blank). */
function parseIntEnvOrNull(name: string, raw: string | undefined): number | null {
  if (!raw || raw.trim() === '') return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a finite integer (got "${raw}")`);
  }
  return n;
}

/** Enforce low > critical; an inverted pair makes the "low" alert level
 *  unreachable (classify checks critical first), silently disabling it. */
function validateThresholds(low: number, critical: number): void {
  if (low <= critical) {
    throw new Error(`LOW_THRESHOLD (${low}) must be greater than CRITICAL_THRESHOLD (${critical})`);
  }
}

/** SMTP host + addresses for the self-hosted email channel. */
export interface EmailConfig {
  to: string;
  from: string;
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface Config {
  desco: {
    accountNo: string;
    meterNo: string;
  };
  // At least one of these two channels is configured - validateEnv enforces it.
  email: EmailConfig | null;
  discordWebhookUrl: string | null;
  thresholds: {
    low: number;
    critical: number;
  };
  /** The DESCO recharge URL embedded in email/SMS templates. */
  rechargeUrl: string;
  /** Roast intensity for this deploy. The hosted app stores it per user; a
   *  self-hosted run has a single owner, so it's one env var. */
  tone: Tone;
}

export interface ServerConfig {
  databaseUrl: string;
  telegramBotToken: string;
  /** override the Telegram Bot API root (mock servers / local bot-api). Null = api.telegram.org */
  telegramApiRoot: string | null;
  /** bot's @username (no @), for deep links like t.me/<username>. Null = links hidden. */
  botUsername: string | null;
  port: number;
  pollIntervalHours: number;
  reminderIntervalHours: number;
  jitterMaxMs: number;
  adminChatId: number | null;
  /** operator's Discord user id, for operator alarms on a Discord-only deploy. Null = Telegram-only alarms. */
  adminDiscordUserId: string | null;
  /** where dashboard links point, e.g. https://app.example.com */
  publicBaseUrl: string;
  /** signs dashboard links; falls back to a hash of the bot token */
  dashboardSecret: string;
  /** operator admin-panel password; null disables the /admin dashboard entirely */
  adminPassword: string | null;
  /** signs admin session cookies; derived from the password so rotating it logs everyone out */
  adminSessionSecret: string;
  /** SaaS outbound email (magic-link sign-in + email alerts). null = email features off */
  mail: { from: string; host: string; port: number; user: string; pass: string } | null;
  defaultThresholds: {
    low: number;
    critical: number;
  };
  /** DESCO recharge URL embedded in alert messages. */
  rechargeUrl: string;
  sms:
    | { gateway: null }
    | { gateway: 'console' }
    | { gateway: 'bulksmsbd'; bulksmsbd: { apiKey: string; senderId: string; baseUrl: string } };
  /**
   * Discord bot (slash commands over the interactions endpoint + DM alerts).
   * null = the Discord bot is off; the per-user webhook channel still works.
   */
  discord: {
    appId: string;
    /** hex-encoded ed25519 key from the dev portal; verifies interaction signatures */
    publicKey: string;
    botToken: string;
    /** override the Discord REST root (mock servers). Null = https://discord.com/api/v10 */
    apiBaseUrl: string | null;
  } | null;
  /**
   * WhatsApp Cloud API: delivery channel + the inbound connect webhook. null = off.
   * The sender is stubbed for now (see notifications/whatsapp); this config gates
   * the channel, the wa.me connect link, and the /whatsapp/webhook route.
   */
  whatsapp: {
    phoneNumberId: string;
    accessToken: string;
    /** the token set in the Meta dashboard; echoed back on GET webhook verification */
    verifyToken: string;
    /** app secret, for validating X-Hub-Signature-256 on inbound POSTs */
    appSecret: string;
    /** the business number (digits only) for wa.me connect links */
    displayNumber: string;
  } | null;
  billing:
    | { provider: 'none' }
    | { provider: 'sandbox' }
    | {
        provider: 'bkash';
        bkash: {
          appKey: string;
          appSecret: string;
          username: string;
          password: string;
          baseUrl: string;
          callbackUrl: string;
        };
      }
    | {
        provider: 'sslcommerz';
        sslcommerz: {
          storeId: string;
          storePassword: string;
          baseUrl: string;
          publicBaseUrl: string;
        };
      };
}

/** Billing gateways carry credentials in the request, so the base URL must be
 *  https (a misconfigured http:// would leak creds). Localhost is allowed for
 *  sandbox/dev. */
function assertHttpsBaseUrl(name: string, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name} is not a valid URL: ${url}`);
  }
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !isLocalhost) {
    throw new Error(`${name} must use https (got ${parsed.protocol}//${parsed.hostname})`);
  }
}

function getBillingConfig(publicBaseUrl: string): ServerConfig['billing'] {
  // Default to 'none' (paid plans off) so a fresh production deploy can never
  // auto-approve upgrades. Sandbox is opt-in for dev/testing only.
  const provider = process.env.BILLING_PROVIDER || 'none';
  if (provider === 'none') {
    return { provider: 'none' };
  }
  if (provider === 'sandbox') {
    return { provider: 'sandbox' };
  }
  if (provider === 'bkash') {
    const required = ['BKASH_APP_KEY', 'BKASH_APP_SECRET', 'BKASH_USERNAME', 'BKASH_PASSWORD'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`BILLING_PROVIDER=bkash requires: ${missing.join(', ')}`);
    }
    const baseUrl = process.env.BKASH_BASE_URL || 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
    assertHttpsBaseUrl('BKASH_BASE_URL', baseUrl);
    return {
      provider: 'bkash',
      bkash: {
        appKey: process.env.BKASH_APP_KEY!,
        appSecret: process.env.BKASH_APP_SECRET!,
        username: process.env.BKASH_USERNAME!,
        password: process.env.BKASH_PASSWORD!,
        baseUrl,
        callbackUrl: `${publicBaseUrl}/pay/bkash/callback`,
      },
    };
  }
  if (provider === 'sslcommerz') {
    if (!process.env.SSLCOMMERZ_STORE_ID || !process.env.SSLCOMMERZ_STORE_PASSWORD) {
      throw new Error(
        'BILLING_PROVIDER=sslcommerz requires SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD'
      );
    }
    const baseUrl = process.env.SSLCOMMERZ_BASE_URL || 'https://sandbox.sslcommerz.com';
    assertHttpsBaseUrl('SSLCOMMERZ_BASE_URL', baseUrl);
    return {
      provider: 'sslcommerz',
      sslcommerz: {
        storeId: process.env.SSLCOMMERZ_STORE_ID,
        storePassword: process.env.SSLCOMMERZ_STORE_PASSWORD,
        baseUrl,
        publicBaseUrl,
      },
    };
  }
  throw new Error(`Unknown BILLING_PROVIDER: ${provider}`);
}

function getSmsConfig(): ServerConfig['sms'] {
  const gateway = process.env.SMS_GATEWAY;
  if (!gateway) {
    return { gateway: null };
  }
  if (gateway === 'console') {
    return { gateway: 'console' };
  }
  if (gateway === 'bulksmsbd') {
    if (!process.env.BULKSMSBD_API_KEY || !process.env.BULKSMSBD_SENDER_ID) {
      throw new Error('SMS_GATEWAY=bulksmsbd requires BULKSMSBD_API_KEY and BULKSMSBD_SENDER_ID');
    }
    return {
      gateway: 'bulksmsbd',
      bulksmsbd: {
        apiKey: process.env.BULKSMSBD_API_KEY,
        senderId: process.env.BULKSMSBD_SENDER_ID,
        baseUrl: process.env.BULKSMSBD_BASE_URL || 'https://bulksmsbd.net/api',
      },
    };
  }
  throw new Error(`Unknown SMS_GATEWAY: ${gateway}`);
}

// SaaS email is opt-in: enabled only when a host and a from-address are set.
// Powers magic-link sign-in for the customer web app and email alerts.
function getMailConfig(): ServerConfig['mail'] {
  const host = process.env.SMTP_HOST;
  const from = process.env.EMAIL_FROM;
  if (!host || !from) {
    return null;
  }
  return {
    from,
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  };
}

// The Discord bot is all-or-nothing, like the email block: a half-filled set
// is almost certainly a typo, so name what's missing instead of silently
// running without the bot.
const DISCORD_BOT_VARS = ['DISCORD_APP_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN'] as const;

function getDiscordConfig(): ServerConfig['discord'] {
  const set = DISCORD_BOT_VARS.filter(key => process.env[key]);
  if (set.length === 0) {
    return null;
  }
  if (set.length < DISCORD_BOT_VARS.length) {
    const missing = DISCORD_BOT_VARS.filter(key => !process.env[key]);
    throw new Error(`Incomplete Discord bot config - also set: ${missing.join(', ')}`);
  }
  const publicKey = process.env.DISCORD_PUBLIC_KEY!;
  if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) {
    throw new Error(
      'DISCORD_PUBLIC_KEY must be the 64-char hex ed25519 key from the Discord developer portal'
    );
  }
  return {
    appId: process.env.DISCORD_APP_ID!,
    publicKey,
    botToken: process.env.DISCORD_BOT_TOKEN!,
    apiBaseUrl: process.env.DISCORD_API_BASE_URL || null,
  };
}

// WhatsApp is all-or-nothing like the Discord bot: a half-filled set is almost
// certainly a typo, so name what's missing rather than half-enabling the channel.
const WHATSAPP_VARS = [
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_DISPLAY_NUMBER',
] as const;

function getWhatsAppConfig(): ServerConfig['whatsapp'] {
  const set = WHATSAPP_VARS.filter(key => process.env[key]);
  if (set.length === 0) {
    return null;
  }
  if (set.length < WHATSAPP_VARS.length) {
    const missing = WHATSAPP_VARS.filter(key => !process.env[key]);
    throw new Error(`Incomplete WhatsApp config - also set: ${missing.join(', ')}`);
  }
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
    appSecret: process.env.WHATSAPP_APP_SECRET!,
    displayNumber: process.env.WHATSAPP_DISPLAY_NUMBER!.replace(/\D/g, ''),
  };
}

const REQUIRED_SERVER_ENV_VARS = ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN'] as const;

export function getServerConfig(): ServerConfig {
  const missing = REQUIRED_SERVER_ENV_VARS.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const publicBaseUrl =
    process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || '3000'}`;

  const dashboardSecret =
    process.env.DASHBOARD_SECRET ||
    crypto.createHash('sha256').update(`dash:${process.env.TELEGRAM_BOT_TOKEN}`).digest('hex');

  const adminPassword = process.env.ADMIN_PASSWORD || null;
  // Bind the session secret to the current password: change the password and
  // every issued cookie stops verifying. Falls back to a constant when the
  // panel is disabled (the secret is never used in that case).
  const adminSessionSecret = crypto
    .createHash('sha256')
    .update(`admin-session:${adminPassword ?? ''}:${dashboardSecret}`)
    .digest('hex');

  const defaultThresholds = {
    low: parseIntEnv('LOW_THRESHOLD', process.env.LOW_THRESHOLD, 150),
    critical: parseIntEnv('CRITICAL_THRESHOLD', process.env.CRITICAL_THRESHOLD, 100),
  };
  validateThresholds(defaultThresholds.low, defaultThresholds.critical);

  return {
    databaseUrl: process.env.DATABASE_URL!,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,
    telegramApiRoot: process.env.TELEGRAM_API_ROOT || null,
    botUsername:
      (process.env.BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '') ||
      null,
    port: parseIntEnv('PORT', process.env.PORT, 3000),
    pollIntervalHours: parseFloatEnv('POLL_INTERVAL_HOURS', process.env.POLL_INTERVAL_HOURS, 6, {
      positive: true,
    }),
    reminderIntervalHours: parseFloatEnv(
      'REMINDER_INTERVAL_HOURS',
      process.env.REMINDER_INTERVAL_HOURS,
      24,
      { positive: true }
    ),
    jitterMaxMs: parseIntEnv('JITTER_MAX_MS', process.env.JITTER_MAX_MS, 4000, { min: 0 }),
    adminChatId: parseIntEnvOrNull('ADMIN_CHAT_ID', process.env.ADMIN_CHAT_ID),
    adminDiscordUserId: process.env.ADMIN_DISCORD_USER_ID || null,
    publicBaseUrl,
    dashboardSecret,
    adminPassword,
    adminSessionSecret,
    mail: getMailConfig(),
    defaultThresholds,
    // DESCO recharge URL embedded in alert messages. Override only for tests
    // or a mirror; the default is the public DESCO portal.
    rechargeUrl: process.env.RECHARGE_URL || DEFAULT_RECHARGE_URL,
    sms: getSmsConfig(),
    discord: getDiscordConfig(),
    whatsapp: getWhatsAppConfig(),
    billing: getBillingConfig(publicBaseUrl),
  };
}

// The meter is always required; the alert channels are "at least one of".
const REQUIRED_DESCO_VARS = ['DESCO_ACCOUNT_NO', 'DESCO_METER_NO'] as const;
// A complete email channel needs all of these (SMTP_PORT defaults to 587).
const EMAIL_VARS = ['EMAIL_TO', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const;

export function validateEnv(): void {
  const missingDesco = REQUIRED_DESCO_VARS.filter(key => !process.env[key]);
  if (missingDesco.length > 0) {
    throw new Error(`Missing required environment variables: ${missingDesco.join(', ')}`);
  }

  // Email is all-or-nothing: a half-filled SMTP block is almost always a typo,
  // so name what's missing rather than silently treating the channel as off.
  const emailSet = EMAIL_VARS.filter(key => process.env[key]);
  const hasEmail = emailSet.length === EMAIL_VARS.length;
  if (emailSet.length > 0 && !hasEmail) {
    const missing = EMAIL_VARS.filter(key => !process.env[key]);
    throw new Error(`Incomplete email config - also set: ${missing.join(', ')}`);
  }

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (webhook && !isValidDiscordWebhookUrl(webhook)) {
    throw new Error('DISCORD_WEBHOOK_URL is set but is not a valid Discord webhook URL');
  }

  if (!hasEmail && !webhook) {
    throw new Error(
      'Configure at least one alert channel: set DISCORD_WEBHOOK_URL, or the SMTP_*/EMAIL_* variables (see README).'
    );
  }
}

export function getConfig(): Config {
  validateEnv();

  // After validateEnv, the email vars are present all-or-nothing.
  const email: EmailConfig | null = process.env.SMTP_HOST
    ? {
        to: process.env.EMAIL_TO!,
        from: process.env.EMAIL_FROM!,
        host: process.env.SMTP_HOST,
        port: parseIntEnv('SMTP_PORT', process.env.SMTP_PORT, 587),
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      }
    : null;

  const thresholds = {
    low: parseIntEnv('LOW_THRESHOLD', process.env.LOW_THRESHOLD, 150),
    critical: parseIntEnv('CRITICAL_THRESHOLD', process.env.CRITICAL_THRESHOLD, 100),
  };
  validateThresholds(thresholds.low, thresholds.critical);

  return {
    desco: {
      accountNo: process.env.DESCO_ACCOUNT_NO!,
      meterNo: process.env.DESCO_METER_NO!,
    },
    email,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || null,
    thresholds,
    rechargeUrl: process.env.RECHARGE_URL || DEFAULT_RECHARGE_URL,
    tone: normalizeTone(process.env.ALERT_TONE),
  };
}
