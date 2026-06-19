import http from 'http';
import crypto from 'crypto';

// Admin auth without sessions in the DB: the cookie *is* the session. Same
// HMAC-SHA256 trick as the dashboard links (token.ts) - payload is just an
// expiry, signed with a secret derived from the admin password. Rotate the
// password and every outstanding cookie stops verifying.

export const ADMIN_COOKIE = 'pr_admin';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hmac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function signAdminSession(
  secret: string,
  expiresAtMs = Date.now() + SESSION_TTL_MS
): string {
  const payload = Buffer.from(String(expiresAtMs)).toString('base64url');
  return `${payload}.${hmac(payload, secret)}`;
}

/** True when the cookie is a valid, unexpired admin session. */
export function verifyAdminSession(token: string, secret: string, now = Date.now()): boolean {
  const [payload, signature] = (token ?? '').split('.');
  if (!payload || !signature || !safeEqual(signature, hmac(payload, secret))) {
    return false;
  }
  const expiresAtMs = parseInt(Buffer.from(payload, 'base64url').toString());
  return Number.isFinite(expiresAtMs) && now <= expiresAtMs;
}

/**
 * CSRF token bound to a session: a separate HMAC of the session cookie. The
 * page embeds it and echoes it back in a header on every mutating request, so
 * a cross-site POST (which can't read the cookie to forge the header) fails.
 */
export function csrfFor(sessionToken: string, secret: string): string {
  return hmac(`csrf:${sessionToken}`, secret);
}

export function verifyCsrf(sessionToken: string, token: string, secret: string): boolean {
  return !!token && safeEqual(token, csrfFor(sessionToken, secret));
}

/** Pulls a single cookie value out of a request's Cookie header. */
export function readCookie(req: http.IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Builds the Set-Cookie value; `secure` should be on whenever served over HTTPS. */
export function sessionCookie(
  value: string,
  secure: boolean,
  maxAgeSec = SESSION_TTL_MS / 1000
): string {
  const attrs = [
    `${ADMIN_COOKIE}=${value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/admin',
    `Max-Age=${Math.floor(maxAgeSec)}`,
  ];
  if (secure) {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}
