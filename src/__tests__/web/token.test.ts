import { signDashboardToken, verifyDashboardToken } from '../../web/token';

const SECRET = 'test-secret';
const now = 1_750_000_000_000;

describe('dashboard tokens', () => {
  it('round-trips a valid token', () => {
    const token = signDashboardToken(42, now + 60_000, SECRET);
    expect(verifyDashboardToken(token, SECRET, now)).toBe(42);
  });

  it('rejects expired tokens', () => {
    const token = signDashboardToken(42, now - 1, SECRET);
    expect(verifyDashboardToken(token, SECRET, now)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signDashboardToken(42, now + 60_000, SECRET);
    const [, signature] = token.split('.');
    const forged = `${Buffer.from(`43.${now + 60_000}`).toString('base64url')}.${signature}`;
    expect(verifyDashboardToken(forged, SECRET, now)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signDashboardToken(42, now + 60_000, 'other-secret');
    expect(verifyDashboardToken(token, SECRET, now)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyDashboardToken('not-a-token', SECRET, now)).toBeNull();
    expect(verifyDashboardToken('', SECRET, now)).toBeNull();
    expect(verifyDashboardToken('a.b.c.d', SECRET, now)).toBeNull();
  });
});
