import http from 'http';
import {
  CookieSpec,
  buildCookie,
  csrfFor as csrfForNs,
  sign,
  unsign,
  verifyCsrf as verifyCsrfNs,
} from './signed-token';

// Admin auth without sessions in the DB: the cookie *is* the session. Same
// HMAC-SHA256 trick as the dashboard links (token.ts) - payload is just an
// expiry, signed with a secret derived from the admin password. Rotate the
// password and every outstanding cookie stops verifying.

export const ADMIN_COOKIE = 'pr_admin';
// The __Host- prefix (Secure + Path=/ + no Domain) stops a vulnerable subdomain
// from injecting a cookie that shadows this one, but the prefix rules require
// Secure, which can't be set over dev HTTP. So the name and path widen only on
// HTTPS deploys; over HTTP the plain name + scoped path keep dev login working.
export function adminCookieName(secure: boolean): string {
  return secure ? `__Host-${ADMIN_COOKIE}` : ADMIN_COOKIE;
}
// Short TTL for a panel that exposes customer PII: the session is stateless, so
// logout can't revoke a stolen cookie - a tight window is the next best thing.
// Operators re-authenticate daily.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Unnamespaced: the session wire format predates namespacing (see signed-token).
const SESSION_NS = '';
const CSRF_NS = 'csrf';

function adminCookieSpec(secure: boolean): CookieSpec {
  return {
    name: adminCookieName(secure),
    // __Host- requires Path=/; the scoped /admin path only applies to the
    // plain-name dev cookie.
    path: secure ? '/' : '/admin',
    // Strict, unlike the customer cookie: nothing legitimately navigates into
    // /admin from another site, so there's no reason to relax it.
    sameSite: 'Strict',
    ttlMs: SESSION_TTL_MS,
  };
}

export function signAdminSession(
  secret: string,
  expiresAtMs = Date.now() + SESSION_TTL_MS
): string {
  return sign(SESSION_NS, String(expiresAtMs), secret);
}

/** True when the cookie is a valid, unexpired admin session. */
export function verifyAdminSession(token: string, secret: string, now = Date.now()): boolean {
  const data = unsign(SESSION_NS, token, secret);
  if (data === null) {
    return false;
  }
  const expiresAtMs = parseInt(data);
  return Number.isFinite(expiresAtMs) && now <= expiresAtMs;
}

export function csrfFor(sessionToken: string, secret: string): string {
  return csrfForNs(CSRF_NS, sessionToken, secret);
}

export function verifyCsrf(sessionToken: string, token: string, secret: string): boolean {
  return verifyCsrfNs(CSRF_NS, sessionToken, token, secret);
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
  return buildCookie(adminCookieSpec(secure), value, secure, maxAgeSec);
}
