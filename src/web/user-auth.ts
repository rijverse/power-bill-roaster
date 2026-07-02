import crypto from 'crypto';

// Customer web-app auth, stateless like the dashboard links (token.ts) and the
// admin panel (admin-session.ts). Two token kinds, both HMAC-SHA256 signed:
//   - magic link  : proves control of an email (sign-in / sign-up), ~20 min
//   - session     : the logged-in cookie, carries userId, 30 days
// A namespace is folded into the signature so one kind can never be replayed as
// the other. readCookie is shared from admin-session.

export const USER_COOKIE = 'pr_user';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAGIC_TTL_MS = 20 * 60 * 1000;
const LINK_TTL_MS = 15 * 60 * 1000;

function hmac(ns: string, payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${ns}:${payload}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function sign(ns: string, data: string, secret: string): string {
  const payload = Buffer.from(data).toString('base64url');
  return `${payload}.${hmac(ns, payload, secret)}`;
}

/** Verifies signature + namespace and returns the decoded data string, else null. */
function unsign(ns: string, token: string, secret: string): string | null {
  const [payload, signature] = (token ?? '').split('.');
  if (!payload || !signature || !safeEqual(signature, hmac(ns, payload, secret))) {
    return null;
  }
  return Buffer.from(payload, 'base64url').toString();
}

export function signMagicLink(
  email: string,
  secret: string,
  expiresAtMs = Date.now() + MAGIC_TTL_MS
): string {
  return sign('magic', `${email.toLowerCase()}\n${expiresAtMs}`, secret);
}

/** Returns the (lower-cased) email for a valid, unexpired magic link, else null. */
export function verifyMagicLink(token: string, secret: string, now = Date.now()): string | null {
  const data = unsign('magic', token, secret);
  if (data === null) {
    return null;
  }
  const sep = data.lastIndexOf('\n');
  const email = data.slice(0, sep);
  const expiresAtMs = parseInt(data.slice(sep + 1));
  if (!email || !Number.isFinite(expiresAtMs) || now > expiresAtMs) {
    return null;
  }
  return email;
}

// A short numeric fallback to the magic link, for people whose mail app opens
// the link in a different browser than the one they started in. Stateless like
// the link: derived from (email, time bucket) so we can recompute and check it
// without storing anything. Valid for the current and previous bucket, so ~10-20
// minutes depending on when in the bucket it was issued.
const CODE_BUCKET_MS = 10 * 60 * 1000;

function magicCodeFor(email: string, secret: string, bucket: number): string {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`magic-code:${email.toLowerCase()}\n${bucket}`)
    .digest();
  return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
}

/** The 6-digit code to email alongside the magic link. */
export function magicCode(email: string, secret: string, now = Date.now()): string {
  return magicCodeFor(email, secret, Math.floor(now / CODE_BUCKET_MS));
}

export function verifyMagicCode(
  email: string,
  code: string,
  secret: string,
  now = Date.now()
): boolean {
  if (!/^\d{6}$/.test(code)) {
    return false;
  }
  const bucket = Math.floor(now / CODE_BUCKET_MS);
  return (
    safeEqual(code, magicCodeFor(email, secret, bucket)) ||
    safeEqual(code, magicCodeFor(email, secret, bucket - 1))
  );
}

export function signUserSession(
  userId: number,
  secret: string,
  expiresAtMs = Date.now() + SESSION_TTL_MS
): string {
  return sign('session', `${userId}\n${expiresAtMs}`, secret);
}

/** Returns the userId for a valid, unexpired session cookie, else null. */
export function verifyUserSession(token: string, secret: string, now = Date.now()): number | null {
  const data = unsign('session', token, secret);
  if (data === null) {
    return null;
  }
  const [userIdRaw, expiresRaw] = data.split('\n');
  const userId = parseInt(userIdRaw);
  const expiresAtMs = parseInt(expiresRaw);
  if (!Number.isFinite(userId) || !Number.isFinite(expiresAtMs) || now > expiresAtMs) {
    return null;
  }
  return userId;
}

// Account-linking token: proves a web user asked to connect Telegram. Carried in
// the bot deep link (t.me/<bot>?start=link_<token>) and short-lived like a magic
// link. Namespaced so it can't be replayed as a session or magic link.
export function signLinkToken(
  userId: number,
  secret: string,
  expiresAtMs = Date.now() + LINK_TTL_MS
): string {
  return sign('tg-link', `${userId}\n${expiresAtMs}`, secret);
}

/** Returns the userId for a valid, unexpired link token, else null. */
export function verifyLinkToken(token: string, secret: string, now = Date.now()): number | null {
  const data = unsign('tg-link', token, secret);
  if (data === null) {
    return null;
  }
  const [userIdRaw, expiresRaw] = data.split('\n');
  const userId = parseInt(userIdRaw);
  const expiresAtMs = parseInt(expiresRaw);
  if (!Number.isFinite(userId) || !Number.isFinite(expiresAtMs) || now > expiresAtMs) {
    return null;
  }
  return userId;
}

/** CSRF token bound to the session cookie (same scheme as the admin panel). */
export function csrfFor(sessionToken: string, secret: string): string {
  return hmac('user-csrf', sessionToken, secret);
}

export function verifyCsrf(sessionToken: string, token: string, secret: string): boolean {
  return !!token && safeEqual(token, csrfFor(sessionToken, secret));
}

/** Set-Cookie for the session; `secure` on whenever served over HTTPS. */
export function userCookie(
  value: string,
  secure: boolean,
  maxAgeSec = SESSION_TTL_MS / 1000
): string {
  const attrs = [
    `${USER_COOKIE}=${value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/app',
    `Max-Age=${Math.floor(maxAgeSec)}`,
  ];
  if (secure) {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}
