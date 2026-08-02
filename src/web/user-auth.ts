import crypto from 'crypto';
import {
  CookieSpec,
  buildCookie,
  csrfFor as csrfForNs,
  safeEqual,
  sign,
  unsignExpiring,
  verifyCsrf as verifyCsrfNs,
} from './signed-token';

// Customer web-app auth, stateless like the dashboard links (token.ts) and the
// admin panel (admin-session.ts). Token kinds, all HMAC-SHA256 signed:
//   - magic link   : proves control of an email (sign-in / sign-up), ~20 min
//   - session      : the logged-in cookie, carries userId, 30 days
//   - tg-link      : proves a web user asked to connect Telegram, 15 min
//   - discord-link : same, for Discord
// Each has its own namespace, so one kind can never be replayed as another (see
// signed-token.ts). readCookie is shared from admin-session.

export const USER_COOKIE = 'pr_user';
// __Host- requires Secure (can't be set over dev HTTP), so the prefix and
// Path=/ widening apply only on HTTPS. See adminCookieName for the same shape.
export function userCookieName(secure: boolean): string {
  return secure ? `__Host-${USER_COOKIE}` : USER_COOKIE;
}
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAGIC_TTL_MS = 20 * 60 * 1000;
const LINK_TTL_MS = 15 * 60 * 1000;

function userCookieSpec(secure: boolean): CookieSpec {
  return {
    name: userCookieName(secure),
    // __Host- requires Path=/; the scoped /app path only applies to the
    // plain-name dev cookie.
    path: secure ? '/' : '/app',
    // Lax, not Strict: the cookie is set on the magic-link GET and must survive
    // the cross-site-initiated redirect to /app (webmail clicks are cross-site
    // navigations - Strict would withhold it and the login page would re-render).
    // Lax still keeps the cookie off all cross-site subresource/POST requests.
    // This asymmetry with the admin cookie is deliberate; don't "unify" it.
    sameSite: 'Lax',
    ttlMs: SESSION_TTL_MS,
  };
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
  const email = unsignExpiring('magic', token, secret, now);
  return email ? email : null;
}

// A short numeric fallback to the magic link, for people whose mail app opens
// the link in a different browser than the one they started in. Stateless like
// the link: derived from (email, time bucket) so we can recompute and check it
// without storing anything. Valid for the current and previous bucket, so ~10-20
// minutes depending on when in the bucket it was issued.
const CODE_BUCKET_MS = 10 * 60 * 1000;

// Not a signed token - a 6-digit code needs the raw digest, not a base64url
// signature - so this reaches for crypto directly rather than signed-token's hmac.
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
  return accountId(unsignExpiring('session', token, secret, now));
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
  return accountId(unsignExpiring('tg-link', token, secret, now));
}

// Discord-linking token: proves the sender controls a Discord account (the bot
// only hands it to that user, ephemerally). Carried in the same Telegram deep
// link as tg-link tokens; carries the Discord user id (a snowflake string, not
// one of our account ids) so it works before the Discord side has an account.
export function signDiscordLinkToken(
  discordUserId: string,
  secret: string,
  expiresAtMs = Date.now() + LINK_TTL_MS
): string {
  return sign('discord-link', `${discordUserId}\n${expiresAtMs}`, secret);
}

/** Returns the Discord user id for a valid, unexpired discord-link token, else null. */
export function verifyDiscordLinkToken(
  token: string,
  secret: string,
  now = Date.now()
): string | null {
  const id = unsignExpiring('discord-link', token, secret, now);
  return id && /^\d{5,25}$/.test(id) ? id : null;
}

// WhatsApp connect token: proves a signed-in web user asked to connect WhatsApp.
// It rides (prefilled) in the wa.me deep link's message text; the inbound webhook
// reads it back and attaches the sender's number to this account. Carries our
// account id, so no server-side pending state is needed - same shape as tg-link.
export function signWhatsAppConnectToken(
  userId: number,
  secret: string,
  expiresAtMs = Date.now() + LINK_TTL_MS
): string {
  return sign('wa-connect', `${userId}\n${expiresAtMs}`, secret);
}

/** Returns the userId for a valid, unexpired WhatsApp connect token, else null. */
export function verifyWhatsAppConnectToken(
  token: string,
  secret: string,
  now = Date.now()
): number | null {
  return accountId(unsignExpiring('wa-connect', token, secret, now));
}

// Merge-confirmation token: names the two accounts a pending merge would combine.
// Minted only once the server has established the requester controls both sides (a
// live session on one, a fresh identity/email proof for the other), so it is the
// capability that authorizes the merge. The confirm POST re-checks the session is
// one of the two. Short-lived like the other link tokens.
export function signMergeToken(
  a: number,
  b: number,
  secret: string,
  expiresAtMs = Date.now() + LINK_TTL_MS
): string {
  return sign('merge', `${a}\n${b}\n${expiresAtMs}`, secret);
}

/** The two account ids a merge token names, or null if invalid/expired. */
export function verifyMergeToken(
  token: string,
  secret: string,
  now = Date.now()
): { a: number; b: number } | null {
  const data = unsignExpiring('merge', token, secret, now);
  if (data === null) {
    return null;
  }
  const parts = data.split('\n');
  if (parts.length !== 2) {
    return null;
  }
  const a = parseInt(parts[0]);
  const b = parseInt(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
    return null;
  }
  return { a, b };
}

/** One of our numeric account ids, or null if the payload didn't carry one. */
function accountId(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const userId = parseInt(raw);
  return Number.isFinite(userId) ? userId : null;
}

/** CSRF token bound to the session cookie (same scheme as the admin panel). */
export function csrfFor(sessionToken: string, secret: string): string {
  return csrfForNs('user-csrf', sessionToken, secret);
}

export function verifyCsrf(sessionToken: string, token: string, secret: string): boolean {
  return verifyCsrfNs('user-csrf', sessionToken, token, secret);
}

/** Set-Cookie for the session; `secure` on whenever served over HTTPS. */
export function userCookie(
  value: string,
  secure: boolean,
  maxAgeSec = SESSION_TTL_MS / 1000
): string {
  return buildCookie(userCookieSpec(secure), value, secure, maxAgeSec);
}
