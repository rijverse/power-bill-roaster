import { listen, closeServers } from '../helpers/http-server';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db } from '../../db';
import { ServerConfig } from '../../config';
import { signAdminSession, csrfFor } from '../../web/admin-session';
import { eraseUser } from '../../core/erase-user';

jest.mock('../../core/erase-user', () => ({ eraseUser: jest.fn(async () => undefined) }));

const SECRET = 'test-secret';
const PASSWORD = 'hunter2';

// A session cookie + matching CSRF token an authed operator would hold.
const cookieToken = signAdminSession(SECRET);
const COOKIE = `pr_admin=${cookieToken}`;
const CSRF = csrfFor(cookieToken, SECRET);

interface Opts {
  adminPassword?: string | null;
  user?: { id: number } | null;
}

async function startServer(opts: Opts = {}) {
  const subscriptions = {
    grant: jest.fn(async () => undefined),
    activeFor: jest.fn(async () => null),
  } as unknown as SubscriptionService;

  const user = opts.user === undefined ? { id: 7 } : opts.user;
  const insert = jest.fn(() => ({ values: jest.fn(async () => undefined) }));
  const db = {
    select: () => ({ from: () => ({ where: async () => (user ? [user] : []) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert,
  } as unknown as Db;

  const scheduler = { lastCycleCompletedAt: new Date() } as unknown as Scheduler;
  const config = {
    port: 0,
    publicBaseUrl: 'http://localhost',
    adminPassword: opts.adminPassword === undefined ? PASSWORD : opts.adminPassword,
    adminSessionSecret: SECRET,
    billing: { provider: 'none' },
  } as unknown as ServerConfig;

  const server = createWebServer(db, scheduler, config, subscriptions);
  return { base: await listen(server), subscriptions, insert };
}

afterEach(closeServers);
afterEach(() => jest.clearAllMocks());

describe('admin panel - access control', () => {
  it('is a 404 entirely when no ADMIN_PASSWORD is set', async () => {
    const { base } = await startServer({ adminPassword: null });
    const res = await fetch(`${base}/admin`);
    expect(res.status).toBe(404);
    const api = await fetch(`${base}/admin/api/overview`);
    expect(api.status).toBe(404);
  });

  it('serves the login page when signed out', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/admin`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Operator sign-in');
  });

  it('serves the app shell when the session cookie is valid', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/admin`, { headers: { Cookie: COOKIE } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Power');
    expect(body).toContain('/admin/api');
  });

  it('rejects /admin/api/* without a session (401)', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/admin/api/overview`);
    expect(res.status).toBe(401);
  });
});

describe('admin panel - login', () => {
  it('rejects the wrong password and sets no cookie', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 'nope' }).toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin?error=1');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('accepts the right password and sets a hardened cookie', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: PASSWORD }).toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('pr_admin=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
  });

  it('rate-limits brute-force login attempts', async () => {
    const { base } = await startServer();
    const attempt = () =>
      fetch(`${base}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: 'nope' }).toString(),
        redirect: 'manual',
      });
    let last = 302;
    for (let i = 0; i < 12; i++) {
      last = (await attempt()).status;
    }
    expect(last).toBe(429);
  });
});

describe('admin panel - actions', () => {
  it('refuses a mutating POST without the CSRF token (403)', async () => {
    const { base, subscriptions } = await startServer();
    const res = await fetch(`${base}/admin/api/users/7/pause`, {
      method: 'POST',
      headers: { Cookie: COOKIE },
    });
    expect(res.status).toBe(403);
    expect(subscriptions.grant).not.toHaveBeenCalled();
  });

  it('pauses a customer with a valid session + CSRF', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/admin/api/users/7/pause`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('grants a plan through the subscription service', async () => {
    const { base, subscriptions } = await startServer();
    const res = await fetch(`${base}/admin/api/users/7/grant`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'plus', days: 30 }),
    });
    expect(res.status).toBe(200);
    expect(subscriptions.grant).toHaveBeenCalledWith(7, 'plus', 30);
  });

  it('rejects an unknown plan on grant (400)', async () => {
    const { base, subscriptions } = await startServer();
    const res = await fetch(`${base}/admin/api/users/7/grant`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'free' }),
    });
    expect(res.status).toBe(400);
    expect(subscriptions.grant).not.toHaveBeenCalled();
  });

  it('erases a customer through eraseUser', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/admin/api/users/7/erase`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF },
    });
    expect(res.status).toBe(200);
    expect(eraseUser as jest.Mock).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it('writes an audit row when an action succeeds', async () => {
    const { base, insert } = await startServer();
    const res = await fetch(`${base}/admin/api/users/7/pause`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF },
    });
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalled();
  });

  it('writes no audit row when the CSRF check fails', async () => {
    const { base, insert } = await startServer();
    const res = await fetch(`${base}/admin/api/users/7/pause`, {
      method: 'POST',
      headers: { Cookie: COOKIE },
    });
    expect(res.status).toBe(403);
    expect(insert).not.toHaveBeenCalled();
  });
});
