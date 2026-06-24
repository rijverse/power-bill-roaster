import 'dotenv/config';
import crypto from 'crypto';

export interface Config {
  desco: {
    accountNo: string;
    meterNo: string;
  };
  email: {
    to: string;
    from: string;
  };
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
  };
  thresholds: {
    low: number;
    critical: number;
  };
  /** The DESCO recharge URL embedded in email/SMS templates. */
  rechargeUrl: string;
}

export interface ServerConfig {
  databaseUrl: string;
  telegramBotToken: string;
  /** override the Telegram Bot API root (mock servers / local bot-api). Null = api.telegram.org */
  telegramApiRoot: string | null;
  port: number;
  pollIntervalHours: number;
  reminderIntervalHours: number;
  jitterMaxMs: number;
  adminChatId: number | null;
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
    return {
      provider: 'bkash',
      bkash: {
        appKey: process.env.BKASH_APP_KEY!,
        appSecret: process.env.BKASH_APP_SECRET!,
        username: process.env.BKASH_USERNAME!,
        password: process.env.BKASH_PASSWORD!,
        baseUrl: process.env.BKASH_BASE_URL || 'https://tokenized.sandbox.bka.sh/v1.2.0-beta',
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
    return {
      provider: 'sslcommerz',
      sslcommerz: {
        storeId: process.env.SSLCOMMERZ_STORE_ID,
        storePassword: process.env.SSLCOMMERZ_STORE_PASSWORD,
        baseUrl: process.env.SSLCOMMERZ_BASE_URL || 'https://sandbox.sslcommerz.com',
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

  return {
    databaseUrl: process.env.DATABASE_URL!,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,
    telegramApiRoot: process.env.TELEGRAM_API_ROOT || null,
    port: parseInt(process.env.PORT || '3000'),
    pollIntervalHours: parseFloat(process.env.POLL_INTERVAL_HOURS || '6'),
    reminderIntervalHours: parseFloat(process.env.REMINDER_INTERVAL_HOURS || '24'),
    jitterMaxMs: parseInt(process.env.JITTER_MAX_MS || '4000'),
    adminChatId: process.env.ADMIN_CHAT_ID ? parseInt(process.env.ADMIN_CHAT_ID) : null,
    publicBaseUrl,
    dashboardSecret,
    adminPassword,
    adminSessionSecret,
    mail: getMailConfig(),
    defaultThresholds: {
      low: parseInt(process.env.LOW_THRESHOLD || '150'),
      critical: parseInt(process.env.CRITICAL_THRESHOLD || '100'),
    },
    // DESCO recharge URL embedded in alert messages. Override only for tests
    // or a mirror; the default is the public DESCO portal.
    rechargeUrl: process.env.RECHARGE_URL || 'https://prepaid.desco.org.bd/',
    sms: getSmsConfig(),
    billing: getBillingConfig(publicBaseUrl),
  };
}

const REQUIRED_ENV_VARS = [
  'DESCO_ACCOUNT_NO',
  'DESCO_METER_NO',
  'EMAIL_TO',
  'EMAIL_FROM',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export function getConfig(): Config {
  validateEnv();

  return {
    desco: {
      accountNo: process.env.DESCO_ACCOUNT_NO!,
      meterNo: process.env.DESCO_METER_NO!,
    },
    email: {
      to: process.env.EMAIL_TO!,
      from: process.env.EMAIL_FROM!,
    },
    smtp: {
      host: process.env.SMTP_HOST!,
      port: parseInt(process.env.SMTP_PORT || '587'),
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
    thresholds: {
      low: parseInt(process.env.LOW_THRESHOLD || '150'),
      critical: parseInt(process.env.CRITICAL_THRESHOLD || '100'),
    },
    rechargeUrl: process.env.RECHARGE_URL || 'https://prepaid.desco.org.bd/',
  };
}
