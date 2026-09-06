import crypto from 'crypto';

// The one implementation of "sign a short string with a secret, verify it later"
// behind every stateless credential we hand out: dashboard links (token.ts),
// admin sessions (admin-session.ts), and the customer app's magic links, session
// cookies and account-linking tokens (user-auth.ts). Those three files kept
// near-identical clones of this code, so a hardening fix to one silently missed
// the other two - they had already drifted apart on SameSite once.
//
// Token shape is `base64url(data).signature`. Data never contains a '.', so the
// split is unambiguous.

/**
 * Namespaced HMAC. The namespace is folded into the signed message so a token
 * minted for one purpose can never verify as another (a magic link replayed as a
 * session, say).
 *
 * An empty namespace signs the bare payload. That is not a stylistic choice: the
 * dashboard-link and admin-session wire formats predate namespacing, and every
 * outstanding link/cookie in the wild is signed that way.
 */
export function hmac(ns: string, payload: string, secret: string): string {
  const message = ns ? `${ns}:${payload}` : payload;
  return crypto.createHmac('sha256', secret).update(message).digest('base64url');
}

/** Constant-time compare. Length is not secret; the contents are. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function sign(ns: string, data: string, secret: string): string {
  const payload = Buffer.from(data).toString('base64url');
  return `${payload}.${hmac(ns, payload, secret)}`;
}

/** Verifies signature + namespace and returns the decoded data string, else null. */
export function unsign(ns: string, token: string, secret: string): string | null {
  const [payload, signature] = (token ?? '').split('.');
  if (!payload || !signature || !safeEqual(signature, hmac(ns, payload, secret))) {
    return null;
  }
  return Buffer.from(payload, 'base64url').toString();
}

/**
 * Unsigns a `${id}\n${expiresAtMs}` payload and enforces the expiry, returning
 * the raw id (the caller validates its shape - a numeric account id, an email, a
 * Discord snowflake). Splits on the *last* newline: an id can't contain one, and
 * this way a forged multi-line payload can't smuggle an early expiry past us.
 */
export function unsignExpiring(
  ns: string,
  token: string,
  secret: string,
  now = Date.now()
): string | null {
  const data = unsign(ns, token, secret);
  if (data === null) {
    return null;
  }
  const sep = data.lastIndexOf('\n');
  if (sep === -1) {
    return null;
  }
  const expiresAtMs = parseInt(data.slice(sep + 1));
  if (!Number.isFinite(expiresAtMs) || now > expiresAtMs) {
    return null;
  }
  return data.slice(0, sep);
}

/**
 * CSRF token bound to a session: a separate HMAC of the session cookie. The page
 * embeds it and echoes it back in a header on every mutating request, so a
 * cross-site POST (which can't read the cookie to forge the header) fails.
 */
export function csrfFor(ns: string, sessionToken: string, secret: string): string {
  return hmac(ns, sessionToken, secret);
}

export function verifyCsrf(
  ns: string,
  sessionToken: string,
  token: string,
  secret: string
): boolean {
  return !!token && safeEqual(token, csrfFor(ns, sessionToken, secret));
}

export interface CookieSpec {
  name: string;
  path: string;
  /** Deliberately per-cookie - see USER_COOKIE_SPEC before you "unify" this. */
  sameSite: 'Strict' | 'Lax';
  ttlMs: number;
}

/** Builds the Set-Cookie value; `secure` should be on whenever served over HTTPS. */
export function buildCookie(
  spec: CookieSpec,
  value: string,
  secure: boolean,
  maxAgeSec = spec.ttlMs / 1000
): string {
  const attrs = [
    `${spec.name}=${value}`,
    'HttpOnly',
    `SameSite=${spec.sameSite}`,
    `Path=${spec.path}`,
    `Max-Age=${Math.floor(maxAgeSec)}`,
  ];
  if (secure) {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}
