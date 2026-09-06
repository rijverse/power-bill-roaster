import { sign, unsign } from './signed-token';

// Signed, expiring dashboard links: the bot hands them out via /dashboard,
// the web server verifies them statelessly. Payload is userId + expiry,
// HMAC-SHA256 signed - no sessions, no cookies, nothing stored.

// Legacy but live: this payload separates userId from expiry with a '.', not the
// '\n' the newer token kinds use, and it isn't namespaced. Both are baked into
// every dashboard link already in the wild - changing either invalidates them, so
// this stays hand-parsed rather than riding unsignExpiring().
const NS = '';

export function signDashboardToken(userId: number, expiresAtMs: number, secret: string): string {
  return sign(NS, `${userId}.${expiresAtMs}`, secret);
}

/** Returns the userId for a valid, unexpired token; null otherwise. */
export function verifyDashboardToken(
  token: string,
  secret: string,
  now = Date.now()
): number | null {
  const data = unsign(NS, token, secret);
  if (data === null) {
    return null;
  }
  const [userIdRaw, expiresRaw] = data.split('.');
  const userId = parseInt(userIdRaw);
  const expiresAtMs = parseInt(expiresRaw);
  if (!Number.isFinite(userId) || !Number.isFinite(expiresAtMs) || now > expiresAtMs) {
    return null;
  }
  return userId;
}
