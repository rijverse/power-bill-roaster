// json in prod (so log shippers can parse fields), pretty in dev.
// also masks emails / phones / account numbers before anything hits stdout -
// once it's logged it's out of our hands.

const isProd = process.env.NODE_ENV === 'production';

// emails, bd phone numbers, "account:NNNN" / "meter:NNNN" pairs, and bearer-
// style hex tokens (40+ chars). the matcher is greedy on purpose; if a log
// line contains PII we want it gone, not partially redacted.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BD_PHONE_RE = /(?:\+?88)?01[3-9]\d{8}\b/g;
const ACCOUNT_RE =
  /\b(account(?:_no)?\s*[=:]\s*|meter(?:_no)?\s*[=:]\s*|account\s+is\s+)(\d{5,20})\b/gi;
const HEX_TOKEN_RE = /\b[a-f0-9]{40,}\b/gi;
// discord webhook tokens are base64url (not hex), so HEX_TOKEN_RE misses them
const DISCORD_WEBHOOK_RE = /(https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/)[\w-]+/gi;

export function maskEmail(value: string): string {
  const [user, domain] = value.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}***@${domain}`;
}

export function maskPhone(value: string): string {
  // keep the country code and last 3, mask the 6 in the middle. short numbers
  // get the blanket *** treatment.
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  const headLen = Math.max(0, digits.length - 6);
  const head = digits.slice(0, headLen);
  const tail = digits.slice(-3);
  return `+${head}${'*'.repeat(6)}${tail}`;
}

export function maskAccount(value: string): string {
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-2)}`;
}

// keep host + webhook id (useful for correlating), drop the secret token segment
export function maskWebhookUrl(value: string): string {
  const m = value.match(/^https:\/\/(discord(?:app)?\.com)\/api\/webhooks\/(\d+)\/.+$/);
  if (!m) return '***';
  return `https://${m[1]}/api/webhooks/${m[2]}/***`;
}

function maskString(value: string): string {
  return value
    .replace(EMAIL_RE, m => maskEmail(m))
    .replace(BD_PHONE_RE, m => maskPhone(m))
    .replace(ACCOUNT_RE, (_m, prefix) => `${prefix}***`)
    .replace(DISCORD_WEBHOOK_RE, (_m, prefix) => `${prefix}***`)
    .replace(HEX_TOKEN_RE, m => `${m.slice(0, 6)}***`);
}

function maskArg(arg: unknown): unknown {
  if (typeof arg === 'string') return maskString(arg);
  if (arg instanceof Error) {
    return { name: arg.name, message: maskString(arg.message), stack: arg.stack };
  }
  return arg;
}

function formatArgs(args: unknown[]): unknown[] {
  return args.map(maskArg);
}

function emit(level: 'info' | 'warn' | 'error', msg: string, args: unknown[]): void {
  const masked = formatArgs(args);
  if (isProd) {
    const record = {
      ts: new Date().toISOString(),
      level,
      msg: maskString(msg),
      ...(masked.length > 0 ? { args: masked } : {}),
    };
    // stderr for warn/error so docker / systemd picks them up at the right
    // severity; stdout for info.
    const stream = level === 'info' ? process.stdout : process.stderr;
    stream.write(JSON.stringify(record) + '\n');
  } else {
    const prefix = `[${level.toUpperCase()}]`;
    const consoleFn =
      level === 'info' ? console.log : level === 'warn' ? console.warn : console.error;
    consoleFn(prefix, msg, ...masked);
  }
}

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

const root: Logger = {
  info: (msg, ...args) => emit('info', msg, args),
  warn: (msg, ...args) => emit('warn', msg, args),
  error: (msg, ...args) => emit('error', msg, args),
};

export const logger = root;
