import {
  signMagicLink,
  verifyMagicLink,
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
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Path=/app');
    expect(c).toContain('Secure');
    expect(userCookie('tok', false)).not.toContain('Secure');
  });
});
