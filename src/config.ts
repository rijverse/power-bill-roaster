import 'dotenv/config';

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
  defaultThresholds: {
    low: number;
    critical: number;
  };
}

const REQUIRED_SERVER_ENV_VARS = ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN'] as const;

export function getServerConfig(): ServerConfig {
  const missing = REQUIRED_SERVER_ENV_VARS.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    databaseUrl: process.env.DATABASE_URL!,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,
    telegramApiRoot: process.env.TELEGRAM_API_ROOT || null,
    port: parseInt(process.env.PORT || '3000'),
    pollIntervalHours: parseFloat(process.env.POLL_INTERVAL_HOURS || '6'),
    reminderIntervalHours: parseFloat(process.env.REMINDER_INTERVAL_HOURS || '24'),
    jitterMaxMs: parseInt(process.env.JITTER_MAX_MS || '4000'),
    adminChatId: process.env.ADMIN_CHAT_ID ? parseInt(process.env.ADMIN_CHAT_ID) : null,
    defaultThresholds: {
      low: parseInt(process.env.LOW_THRESHOLD || '150'),
      critical: parseInt(process.env.CRITICAL_THRESHOLD || '100'),
    },
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
  };
}
