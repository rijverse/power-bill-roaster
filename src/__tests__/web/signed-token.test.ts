import {
  CookieSpec,
  buildCookie,
  csrfFor,
  hmac,
  safeEqual,
  sign,
  unsign,
  unsignExpiring,
  verifyCsrf,
} from '../../web/signed-token';

const SECRET = 'test-secret';
const NAMESPACES = ['magic', 'session', 'tg-link', 'discord-link'];

describe('signed-token', () => {
  describe('namespace confinement', () => {
    // The property the whole namespacing scheme exists for: a token minted for
    // one purpose must never verify as another. A magic link that unsigns as a
    // session would be an account takeover.
    it.each(NAMESPACES)('a %s token verifies under its own namespace only', minted => {
      const token = sign(minted, 'payload\n' + (Date.now() + 60_000), SECRET);
      for (const ns of NAMESPACES) {
        if (ns === minted) {
          expect(unsign(ns, token, SECRET)).not.toBeNull();
        } else {
          expect(unsign(ns, token, SECRET)).toBeNull();
        }
      }
    });

    it('does not verify a namespaced token as unnamespaced (or the reverse)', () => {
      const namespaced = sign('session', 'data', SECRET);
      const bare = sign('', 'data', SECRET);
      expect(unsign('', namespaced, SECRET)).toBeNull();
      expect(unsign('session', bare, SECRET)).toBeNull();
    });

    it('signs the bare payload when the namespace is empty', () => {
      // The legacy wire format (dashboard links, admin sessions) depends on this.
      const payload = Buffer.from('data').toString('base64url');
      expect(sign('', 'data', SECRET)).toBe(`${payload}.${hmac('', payload, SECRET)}`);
    });
  });

  describe('unsign', () => {
    it('rejects a tampered payload, a tampered signature, and junk', () => {
      const token = sign('session', 'data', SECRET);
      const [payload, signature] = token.split('.');
      expect(unsign('session', `${payload}x.${signature}`, SECRET)).toBeNull();
      expect(unsign('session', `${payload}.${signature}x`, SECRET)).toBeNull();
      expect(unsign('session', 'garbage', SECRET)).toBeNull();
      expect(unsign('session', '', SECRET)).toBeNull();
    });

    it('rejects a token signed with a different secret', () => {
      expect(unsign('session', sign('session', 'data', 'other'), SECRET)).toBeNull();
    });
  });

  describe('unsignExpiring', () => {
    const future = () => Date.now() + 60_000;

    it('returns the id before expiry and null after', () => {
      const token = sign('session', `42\n${future()}`, SECRET);
      expect(unsignExpiring('session', token, SECRET)).toBe('42');
      expect(unsignExpiring('session', token, SECRET, Date.now() + 120_000)).toBeNull();
    });

    it('returns the id verbatim - the caller validates its shape', () => {
      const token = sign('magic', `a@b.com\n${future()}`, SECRET);
      expect(unsignExpiring('magic', token, SECRET)).toBe('a@b.com');
    });

    it('rejects a payload with no expiry at all', () => {
      expect(unsignExpiring('session', sign('session', '42', SECRET), SECRET)).toBeNull();
    });

    it('splits on the last newline, so a multi-line id cannot smuggle an expiry', () => {
      // Reading the *first* newline here would take "99999999999999" as the
      // expiry and hand back an id of "42".
      const token = sign('session', `42\n${future()}\nnot-a-number`, SECRET);
      expect(unsignExpiring('session', token, SECRET)).toBeNull();
    });
  });

  describe('csrf', () => {
    it('binds the token to the session and the namespace', () => {
      const csrf = csrfFor('user-csrf', 'session-a', SECRET);
      expect(verifyCsrf('user-csrf', 'session-a', csrf, SECRET)).toBe(true);
      expect(verifyCsrf('user-csrf', 'session-b', csrf, SECRET)).toBe(false);
      expect(verifyCsrf('csrf', 'session-a', csrf, SECRET)).toBe(false);
    });

    it('rejects an empty token', () => {
      expect(verifyCsrf('user-csrf', 'session-a', '', SECRET)).toBe(false);
    });
  });

  describe('safeEqual', () => {
    it('is false on a length mismatch and on differing content', () => {
      expect(safeEqual('abc', 'abcd')).toBe(false);
      expect(safeEqual('abc', 'abd')).toBe(false);
      expect(safeEqual('abc', 'abc')).toBe(true);
    });
  });

  describe('buildCookie', () => {
    const admin: CookieSpec = {
      name: 'pr_admin',
      path: '/admin',
      sameSite: 'Strict',
      ttlMs: 24 * 60 * 60 * 1000,
    };
    const user: CookieSpec = {
      name: 'pr_user',
      path: '/app',
      sameSite: 'Lax',
      ttlMs: 30 * 24 * 60 * 60 * 1000,
    };

    it('keeps the admin cookie Strict and the user cookie Lax', () => {
      // Not an oversight: the user cookie must survive the cross-site magic-link
      // redirect. Locking this in so nobody "unifies" the two.
      expect(buildCookie(admin, 'v', true)).toContain('SameSite=Strict');
      expect(buildCookie(admin, 'v', true)).toContain('Path=/admin');
      expect(buildCookie(user, 'v', true)).toContain('SameSite=Lax');
      expect(buildCookie(user, 'v', true)).toContain('Path=/app');
    });

    it('is always HttpOnly, and Secure only when asked', () => {
      expect(buildCookie(admin, 'v', true)).toContain('HttpOnly');
      expect(buildCookie(admin, 'v', true)).toContain('Secure');
      expect(buildCookie(admin, 'v', false)).not.toContain('Secure');
    });

    it('defaults Max-Age to the spec TTL and honors an override (Max-Age=0 clears)', () => {
      expect(buildCookie(admin, 'v', false)).toContain('Max-Age=86400');
      expect(buildCookie(admin, '', false, 0)).toContain('Max-Age=0');
    });
  });
});
