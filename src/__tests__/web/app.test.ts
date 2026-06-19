import http from 'http';
import { AddressInfo } from 'net';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db } from '../../db';
import { ServerConfig } from '../../config';
import { Mailer } from '../../services/mailer';
import { signUserSession, signMagicLink, csrfFor } from '../../web/user-auth';
import { eraseUser } from '../../core/erase-user';

jest.mock('../../core/erase-user', () => ({ eraseUser: jest.fn(async () => undefined) }));

const SECRET = 'test-secret';
const cookieToken = signUserSession(1, SECRET);
const COOKIE = `pr_user=${cookieToken}`;
const CSRF = csrfFor(cookieToken, SECRET);

function startServer(opts: { mailer?: Mailer | null } = {}) {
  // Every select returns one row that satisfies both "user" and "verified email
  // channel" shapes, so find-or-create takes the existing-account path.
  const db = {
    select: () => ({
      from: () => ({
        where: async () => [
          { id: 1, email: 'me@example.com', plan: 'free', verified: true, enabled: true },
        ],
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    $count: async () => 0,
  } as unknown as Db;
  const scheduler = { lastCycleCompletedAt: new Date() } as unknown as Scheduler;
  const config = {
    port: 0,
    publicBaseUrl: 'http://localhost',
    dashboardSecret: SECRET,
  } as unknown as ServerConfig;
  const mailer =
    opts.mailer === undefined
      ? ({ from: 'x@y.z', send: jest.fn(async () => undefined) } as unknown as Mailer)
      : opts.mailer;

  const server = createWebServer(db, scheduler, config, {} as SubscriptionService, mailer);
  return new Promise<{ server: http.Server; base: string; mailer: Mailer | null }>(resolve => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}`, mailer });
    });
  });
}

const form = (path: string, base: string, body: Record<string, string>) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  });

afterEach(() => jest.clearAllMocks());

describe('app - login page', () => {
  it('shows the email sign-in form when signed out', async () => {
    const { server, base } = await startServer();
    const res = await fetch(`${base}/app`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('sign-in link');
    server.close();
  });

  it('shows a "not configured" notice when no mailer is set', async () => {
    const { server, base } = await startServer({ mailer: null });
    expect(await (await fetch(`${base}/app`)).text()).toContain('not configured');
    server.close();
  });

  it('serves the app shell with a valid session cookie', async () => {
    const { server, base } = await startServer();
    const res = await fetch(`${base}/app`, { headers: { Cookie: COOKIE } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('/app/api');
    server.close();
  });
});

describe('app - magic-link sign in', () => {
  it('emails a link for a valid address', async () => {
    const { server, base, mailer } = await startServer();
    const res = await form('/app/login', base, { email: 'Person@Example.com' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app?status=sent');
    expect(mailer!.send).toHaveBeenCalledTimes(1);
    expect((mailer!.send as jest.Mock).mock.calls[0][0]).toBe('person@example.com');
    server.close();
  });

  it('rejects a bad address without emailing', async () => {
    const { server, base, mailer } = await startServer();
    const res = await form('/app/login', base, { email: 'nope' });
    expect(res.headers.get('location')).toBe('/app?status=bademail');
    expect(mailer!.send).not.toHaveBeenCalled();
    server.close();
  });

  it('is disabled when email is not configured', async () => {
    const { server, base } = await startServer({ mailer: null });
    const res = await form('/app/login', base, { email: 'a@b.com' });
    expect(res.headers.get('location')).toBe('/app?status=disabled');
    server.close();
  });

  it('rate-limits repeated link requests', async () => {
    const { server, base } = await startServer();
    let last = 302;
    let location = '';
    for (let i = 0; i < 6; i++) {
      const res = await form('/app/login', base, { email: 'spammy@example.com' });
      last = res.status;
      location = res.headers.get('location') ?? '';
    }
    expect(last).toBe(302);
    expect(location).toBe('/app?status=ratelimited');
    server.close();
  });

  it('verifies a magic link, sets the session cookie, redirects to /app', async () => {
    const { server, base } = await startServer();
    const token = signMagicLink('me@example.com', SECRET);
    const res = await fetch(`${base}/app/auth?token=${encodeURIComponent(token)}`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app');
    expect(res.headers.get('set-cookie') ?? '').toContain('pr_user=');
    server.close();
  });

  it('rejects an invalid magic link', async () => {
    const { server, base } = await startServer();
    const res = await fetch(`${base}/app/auth?token=garbage`, { redirect: 'manual' });
    expect(res.headers.get('location')).toBe('/app?status=badlink');
    server.close();
  });
});

describe('app - API access control', () => {
  it('401s the API without a session', async () => {
    const { server, base } = await startServer();
    expect((await fetch(`${base}/app/api/me`)).status).toBe(401);
    server.close();
  });

  it('403s a mutation without the CSRF token', async () => {
    const { server, base } = await startServer();
    const res = await fetch(`${base}/app/api/meters`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountNo: '12345678', meterNo: '87654321' }),
    });
    expect(res.status).toBe(403);
    server.close();
  });

  it('validates meter input (bad digits -> 400)', async () => {
    const { server, base } = await startServer();
    const res = await fetch(`${base}/app/api/meters`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountNo: 'abc', meterNo: '12' }),
    });
    expect(res.status).toBe(400);
    server.close();
  });

  it('deletes the account via eraseUser and clears the cookie', async () => {
    const { server, base } = await startServer();
    const res = await fetch(`${base}/app/api/account/delete`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF },
    });
    expect(res.status).toBe(200);
    expect(eraseUser as jest.Mock).toHaveBeenCalledWith(expect.anything(), 1);
    expect(res.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
    server.close();
  });
});
