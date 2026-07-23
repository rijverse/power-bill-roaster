import http from 'http';
import {
  signAdminSession,
  verifyAdminSession,
  csrfFor,
  verifyCsrf,
  readCookie,
  sessionCookie,
  adminCookieName,
  ADMIN_COOKIE,
} from '../../web/admin-session';

const SECRET = 'unit-test-secret';

describe('admin session tokens', () => {
  it('verifies a freshly signed session', () => {
    const token = signAdminSession(SECRET);
    expect(verifyAdminSession(token, SECRET)).toBe(true);
  });

  it('rejects an expired session', () => {
    const token = signAdminSession(SECRET, Date.now() - 1000);
    expect(verifyAdminSession(token, SECRET)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const token = signAdminSession(SECRET);
    const [payload] = token.split('.');
    expect(verifyAdminSession(`${payload}.deadbeef`, SECRET)).toBe(false);
  });

  it('rejects a session signed with a different secret', () => {
    const token = signAdminSession(SECRET);
    expect(verifyAdminSession(token, 'other-secret')).toBe(false);
  });

  it('rejects empty / malformed tokens', () => {
    expect(verifyAdminSession('', SECRET)).toBe(false);
    expect(verifyAdminSession('nodot', SECRET)).toBe(false);
  });
});

describe('csrf tokens', () => {
  it('binds a csrf token to a session', () => {
    const session = signAdminSession(SECRET);
    const csrf = csrfFor(session, SECRET);
    expect(verifyCsrf(session, csrf, SECRET)).toBe(true);
  });

  it('rejects a csrf token from a different session', () => {
    const csrf = csrfFor(signAdminSession(SECRET), SECRET);
    const otherSession = signAdminSession(SECRET, Date.now() + 99999);
    expect(verifyCsrf(otherSession, csrf, SECRET)).toBe(false);
  });

  it('rejects an empty csrf token', () => {
    const session = signAdminSession(SECRET);
    expect(verifyCsrf(session, '', SECRET)).toBe(false);
  });
});

describe('cookie helpers', () => {
  it('reads a named cookie out of the header', () => {
    const req = {
      headers: { cookie: `foo=1; ${ADMIN_COOKIE}=abc.def; bar=2` },
    } as http.IncomingMessage;
    expect(readCookie(req, ADMIN_COOKIE)).toBe('abc.def');
    expect(readCookie(req, 'missing')).toBeNull();
  });

  it('returns null when there is no cookie header', () => {
    const req = { headers: {} } as http.IncomingMessage;
    expect(readCookie(req, ADMIN_COOKIE)).toBeNull();
  });

  it('serializes a hardened session cookie with __Host- prefix over HTTPS', () => {
    const c = sessionCookie('tok', true);
    expect(c).toContain(`${adminCookieName(true)}=tok`);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Path=/');
    expect(c).toContain('Secure');
  });

  it('uses the plain name and scoped path over HTTP (dev)', () => {
    const c = sessionCookie('tok', false);
    expect(c).toContain(`${ADMIN_COOKIE}=tok`);
    expect(c).toContain('Path=/admin');
    expect(c).not.toContain('Secure');
    expect(c).not.toContain('__Host-');
  });
});
