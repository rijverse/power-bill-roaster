import {
  signMagicLink,
  verifyMagicLink,
  magicCode,
  verifyMagicCode,
  signLinkToken,
  verifyLinkToken,
  signUserSession,
  verifyUserSession,
  csrfFor,
  verifyCsrf,
  userCookie,
  USER_COOKIE,
} from '../../web/user-auth';

const SECRET = 'unit-secret';

describe('magic links', () => {
  it('round-trips a (lower-cased) email', () => {
    const token = signMagicLink('User@Example.com', SECRET);
    expect(verifyMagicLink(token, SECRET)).toBe('user@example.com');
  });

  it('rejects an expired link', () => {
    const token = signMagicLink('a@b.com', SECRET, Date.now() - 1000);
    expect(verifyMagicLink(token, SECRET)).toBeNull();
  });

  it('rejects a tampered or wrong-secret link', () => {
    const token = signMagicLink('a@b.com', SECRET);
    const [payload] = token.split('.');
    expect(verifyMagicLink(`${payload}.deadbeef`, SECRET)).toBeNull();
    expect(verifyMagicLink(token, 'other')).toBeNull();
  });
});

describe('magic code fallback', () => {
  const now = 1_700_000_000_000;

  it('is a deterministic 6-digit code per email + time bucket', () => {
    const a = magicCode('User@Example.com', SECRET, now);
    const b = magicCode('user@example.com', SECRET, now);
    expect(a).toMatch(/^\d{6}$/);
    expect(a).toBe(b); // case-insensitive email, same bucket
  });

  it('accepts the code in the current and previous bucket', () => {
    const code = magicCode('a@b.com', SECRET, now);
    expect(verifyMagicCode('a@b.com', code, SECRET, now)).toBe(true);
    // ~10 min later it is the previous bucket's code, still accepted
    expect(verifyMagicCode('a@b.com', code, SECRET, now + 10 * 60 * 1000)).toBe(true);
  });

  it('rejects a code that is two buckets stale', () => {
    const code = magicCode('a@b.com', SECRET, now);
    expect(verifyMagicCode('a@b.com', code, SECRET, now + 21 * 60 * 1000)).toBe(false);
  });

  it('rejects a wrong code, a different email, and malformed input', () => {
    const code = magicCode('a@b.com', SECRET, now);
    expect(verifyMagicCode('other@b.com', code, SECRET, now)).toBe(false);
    expect(verifyMagicCode('a@b.com', '12ab56', SECRET, now)).toBe(false);
    expect(verifyMagicCode('a@b.com', '', SECRET, now)).toBe(false);
  });
});

describe('user sessions', () => {
  it('round-trips a userId', () => {
    const token = signUserSession(42, SECRET);
    expect(verifyUserSession(token, SECRET)).toBe(42);
  });

  it('rejects an expired session', () => {
    expect(verifyUserSession(signUserSession(42, SECRET, Date.now() - 1), SECRET)).toBeNull();
  });

  it('will not accept a magic-link token as a session (namespaced)', () => {
    const magic = signMagicLink('a@b.com', SECRET);
    expect(verifyUserSession(magic, SECRET)).toBeNull();
  });

  it('will not accept a session token as a magic link (namespaced)', () => {
    const session = signUserSession(1, SECRET);
    expect(verifyMagicLink(session, SECRET)).toBeNull();
  });
});

describe('account-link tokens', () => {
  it('round-trips a userId', () => {
    expect(verifyLinkToken(signLinkToken(42, SECRET), SECRET)).toBe(42);
  });

  it('rejects an expired link token', () => {
    expect(verifyLinkToken(signLinkToken(42, SECRET, Date.now() - 1), SECRET)).toBeNull();
  });

  it('is namespaced apart from sessions and magic links', () => {
    const link = signLinkToken(42, SECRET);
    expect(verifyUserSession(link, SECRET)).toBeNull();
    expect(verifyMagicLink(link, SECRET)).toBeNull();
    // and a session isn't a valid link token
    expect(verifyLinkToken(signUserSession(42, SECRET), SECRET)).toBeNull();
  });
});

describe('csrf + cookie', () => {
  it('binds csrf to the session', () => {
    const session = signUserSession(1, SECRET);
    expect(verifyCsrf(session, csrfFor(session, SECRET), SECRET)).toBe(true);
    expect(verifyCsrf(session, 'nope', SECRET)).toBe(false);
  });

  it('builds a hardened, /app-scoped cookie', () => {
    const c = userCookie('tok', true);
    expect(c).toContain(`${USER_COOKIE}=tok`);
    expect(c).toContain('HttpOnly');
    // Lax, NOT Strict: the magic-link flow sets this cookie on a cross-site
    // navigation (a click in webmail) and immediately redirects to /app -
    // Strict would withhold the cookie on that redirect and the user would
    // land back on the login page. Regression guard for the sign-in flow.
    expect(c).toContain('SameSite=Lax');
    expect(c).not.toContain('SameSite=Strict');
    expect(c).toContain('Path=/app');
    expect(c).toContain('Secure');
    expect(userCookie('tok', false)).not.toContain('Secure');
  });
});
