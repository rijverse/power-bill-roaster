import { listen, closeServers } from '../helpers/http-server';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db } from '../../db';
import { ServerConfig } from '../../config';
import { Mailer } from '../../services/mailer';
import { signUserSession, signMagicLink, magicCode, csrfFor } from '../../web/user-auth';
import { eraseUser } from '../../core/erase-user';

jest.mock('../../core/erase-user', () => ({ eraseUser: jest.fn(async () => undefined) }));

const SECRET = 'test-secret';
const cookieToken = signUserSession(1, SECRET);
const COOKIE = `pr_user=${cookieToken}`;
const CSRF = csrfFor(cookieToken, SECRET);

async function startServer(opts: { mailer?: Mailer | null } = {}) {
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
  return { base: await listen(server), mailer };
}

const form = (path: string, base: string, body: Record<string, string>) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  });

afterEach(closeServers);
afterEach(() => jest.clearAllMocks());

describe('app - login page', () => {
  it('shows the email sign-in form when signed out', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/app`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('sign-in link');
  });

  it('shows a "not configured" notice when no mailer is set', async () => {
    const { base } = await startServer({ mailer: null });
    expect(await (await fetch(`${base}/app`)).text()).toContain('not configured');
  });

  it('serves the app shell with a valid session cookie', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/app`, { headers: { Cookie: COOKIE } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('/app/api');
  });
});

describe('app - magic-link sign in', () => {
  it('emails a link for a valid address', async () => {
    const { base, mailer } = await startServer();
    const res = await form('/app/login', base, { email: 'Person@Example.com' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app?status=sent');
    expect(mailer!.send).toHaveBeenCalledTimes(1);
    expect((mailer!.send as jest.Mock).mock.calls[0][0]).toBe('person@example.com');
  });

  it('rejects a bad address without emailing', async () => {
    const { base, mailer } = await startServer();
    const res = await form('/app/login', base, { email: 'nope' });
    expect(res.headers.get('location')).toBe('/app?status=bademail');
    expect(mailer!.send).not.toHaveBeenCalled();
  });

  it('is disabled when email is not configured', async () => {
    const { base } = await startServer({ mailer: null });
    const res = await form('/app/login', base, { email: 'a@b.com' });
    expect(res.headers.get('location')).toBe('/app?status=disabled');
  });

  it('rate-limits repeated link requests', async () => {
    const { base } = await startServer();
    let last = 302;
    let location = '';
    for (let i = 0; i < 6; i++) {
      const res = await form('/app/login', base, { email: 'spammy@example.com' });
      last = res.status;
      location = res.headers.get('location') ?? '';
    }
    expect(last).toBe(302);
    expect(location).toBe('/app?status=ratelimited');
  });

  it('verifies a magic link, sets the session cookie, redirects to /app', async () => {
    const { base } = await startServer();
    const token = signMagicLink('me@example.com', SECRET);
    const res = await fetch(`${base}/app/auth?token=${encodeURIComponent(token)}`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app');
    expect(res.headers.get('set-cookie') ?? '').toContain('pr_user=');
  });

  it('rejects an invalid magic link', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/app/auth?token=garbage`, { redirect: 'manual' });
    expect(res.headers.get('location')).toBe('/app?status=badlink');
  });

  it('signs in with the emailed code and sets the session cookie', async () => {
    const { base } = await startServer();
    const code = magicCode('me@example.com', SECRET);
    const res = await form('/app/login/code', base, { email: 'me@example.com', code });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app');
    expect(res.headers.get('set-cookie') ?? '').toContain('pr_user=');
  });

  it('rejects a wrong code', async () => {
    const { base } = await startServer();
    const res = await form('/app/login/code', base, { email: 'me@example.com', code: '000000' });
    expect(res.headers.get('location')).toBe('/app?status=badcode');
  });

  it('rate-limits repeated code attempts', async () => {
    const { base } = await startServer();
    let location = '';
    for (let i = 0; i < 6; i++) {
      const res = await form('/app/login/code', base, {
        email: 'guessy@example.com',
        code: '111111',
      });
      location = res.headers.get('location') ?? '';
    }
    expect(location).toBe('/app?status=ratelimited');
  });
});

describe('app - logout', () => {
  // A plain form POST above the /app/api/ choke point, so it carries the token in
  // the body. It had no CSRF check at all before - a cross-site POST could sign
  // a user out.
  const logout = (base: string, body: Record<string, string>) =>
    fetch(`${base}/app/logout`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      redirect: 'manual',
    });

  it('clears the cookie when the form carries a valid token', async () => {
    const { base } = await startServer();
    const res = await logout(base, { csrf: CSRF });
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('does not clear the cookie without a token', async () => {
    const { base } = await startServer();
    const res = await logout(base, {});
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('app - API access control', () => {
  it('401s the API without a session', async () => {
    const { base } = await startServer();
    expect((await fetch(`${base}/app/api/me`)).status).toBe(401);
  });

  it('403s a mutation without the CSRF token', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/app/api/meters`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountNo: '12345678', meterNo: '87654321' }),
    });
    expect(res.status).toBe(403);
  });

  it('validates meter input (bad digits -> 400)', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/app/api/meters`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountNo: 'abc', meterNo: '12' }),
    });
    expect(res.status).toBe(400);
  });

  it('deletes the account via eraseUser and clears the cookie', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/app/api/account/delete`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF },
    });
    expect(res.status).toBe(200);
    expect(eraseUser as jest.Mock).toHaveBeenCalledWith(expect.anything(), 1);
    expect(res.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });
});
