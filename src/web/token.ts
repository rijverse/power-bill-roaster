import crypto from 'crypto';

// Signed, expiring dashboard links: the bot hands them out via /dashboard,
// the web server verifies them statelessly. Payload is userId + expiry,
// HMAC-SHA256 signed - no sessions, no cookies, nothing stored.

function hmac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signDashboardToken(userId: number, expiresAtMs: number, secret: string): string {
  const payload = Buffer.from(`${userId}.${expiresAtMs}`).toString('base64url');
  return `${payload}.${hmac(payload, secret)}`;
}

/** Returns the userId for a valid, unexpired token; null otherwise. */
export function verifyDashboardToken(
  token: string,
  secret: string,
  now = Date.now()
): number | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return null;
  }
  const expected = hmac(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  const decoded = Buffer.from(payload, 'base64url').toString();
  const [userIdRaw, expiresRaw] = decoded.split('.');
  const userId = parseInt(userIdRaw);
  const expiresAtMs = parseInt(expiresRaw);
  if (!Number.isFinite(userId) || !Number.isFinite(expiresAtMs) || now > expiresAtMs) {
    return null;
  }
  return userId;
}
