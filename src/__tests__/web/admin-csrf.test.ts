import { listen, closeServers } from '../helpers/http-server';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db } from '../../db';
import { ServerConfig } from '../../config';
import { signAdminSession, csrfFor } from '../../web/admin-session';

jest.mock('../../core/erase-user', () => ({ eraseUser: jest.fn(async () => undefined) }));

const SECRET = 'test-secret';
const cookieToken = signAdminSession(SECRET);
const COOKIE = `pr_admin=${cookieToken}`;
const CSRF = csrfFor(cookieToken, SECRET);

async function startServer(): Promise<string> {
  const db = {
    select: () => ({ from: () => ({ where: async () => [{ id: 7, plan: 'free' }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
    $count: async () => 0,
  } as unknown as Db;
  const subscriptions = {
    grant: jest.fn(async () => undefined),
    activeFor: jest.fn(async () => null),
  } as unknown as SubscriptionService;
  const scheduler = { lastCycleCompletedAt: new Date(), isPolling: false } as unknown as Scheduler;
  const config = {
    port: 0,
    publicBaseUrl: 'http://localhost',
    adminPassword: 'hunter2',
    adminSessionSecret: SECRET,
    billing: { provider: 'none' },
  } as unknown as ServerConfig;
  return listen(createWebServer(db, scheduler, config, subscriptions));
}

afterEach(closeServers);

// The CSRF check used to be pasted into four route branches. A new mutating
// route added without the paste shipped unprotected and nothing caught it. The
// check is now hoisted to one gate, and this enumerates the mutating routes so
// that a future one can't quietly skip it.
const MUTATING_API_ROUTES = [
  '/admin/api/poll',
  '/admin/api/alerts/requeue-all',
  '/admin/api/alerts/1/requeue',
  '/admin/api/users/7/grant',
  '/admin/api/users/7/pause',
  '/admin/api/users/7/resume',
  '/admin/api/users/7/revoke',
  '/admin/api/users/7/erase',
  '/admin/api/users/7/meters/1/pause',
  '/admin/api/users/7/meters/1/resume',
  '/admin/api/users/7/meters/1/recheck',
];

describe('admin CSRF gate', () => {
  it.each(MUTATING_API_ROUTES)('403s POST %s without a CSRF token', async path => {
    const base = await startServer();
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'plus', days: 30 }),
    });
    expect(res.status).toBe(403);
  });

  it.each(MUTATING_API_ROUTES)('does not 403 POST %s with a valid token', async path => {
    const base = await startServer();
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'plus', days: 30 }),
    });
    expect(res.status).not.toBe(403);
  });

  it('403s an unknown mutating method too (a future PUT/DELETE is covered by default)', async () => {
    const base = await startServer();
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(`${base}/admin/api/users/7/pause`, {
        method,
        headers: { Cookie: COOKIE },
      });
      expect(res.status).toBe(403);
    }
  });

  it('still 401s (not 403s) an unauthenticated API call', async () => {
    // The CSRF gate must sit *after* the session check, or we'd leak a 403 where
    // the contract says 401.
    const base = await startServer();
    const res = await fetch(`${base}/admin/api/users/7/pause`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('leaves GETs alone', async () => {
    // Only that the gate doesn't fire - the handler's own 200 is admin.test.ts's
    // business, and the stub db here isn't rich enough to serve it.
    const base = await startServer();
    const res = await fetch(`${base}/admin/api/overview`, { headers: { Cookie: COOKIE } });
    expect(res.status).not.toBe(403);
  });
});

describe('admin logout', () => {
  // A plain form POST, so the token rides in the body. Before this it had no
  // CSRF check at all and a cross-site POST could sign an operator out.
  const logout = (base: string, body: Record<string, string>) =>
    fetch(`${base}/admin/logout`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      redirect: 'manual',
    });

  it('clears the cookie when the form carries a valid token', async () => {
    const base = await startServer();
    const res = await logout(base, { csrf: CSRF });
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('does not clear the cookie without a token', async () => {
    const base = await startServer();
    const res = await logout(base, {});
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
