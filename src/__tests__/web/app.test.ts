import { listen, closeServers } from '../helpers/http-server';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db, schema } from '../../db';
import { ServerConfig } from '../../config';
import { Mailer } from '../../services/mailer';
import {
  signUserSession,
  signMagicLink,
  magicCode,
  csrfFor,
  signDiscordLinkToken,
  signMergeToken,
} from '../../web/user-auth';
import { eraseUser } from '../../core/erase-user';

jest.mock('../../core/erase-user', () => ({ eraseUser: jest.fn(async () => undefined) }));

const SECRET = 'test-secret';
const cookieToken = signUserSession(1, SECRET);
const COOKIE = `pr_user=${cookieToken}`;
const CSRF = csrfFor(cookieToken, SECRET);

async function startServer(opts: { mailer?: Mailer | null; db?: Db } = {}) {
  // A fake that satisfies the identity-backed sign-in path: the email identity
  // resolves to user 1 (find-or-create takes the existing-account path, no
  // insert). findUserByProvider joins identities -> users and reads `.user`,
  // while linkIdentity/contactTargets read the raw identity row - told apart by
  // whether innerJoin() was called on the builder.
  const cannedUser = { id: 1, plan: 'free', tonePref: 'savage', quietStart: null, quietEnd: null };
  const emailIdentity = { id: 1, userId: 1, provider: 'email', providerUid: 'me@example.com' };
  const emailChannel = {
    id: 1,
    userId: 1,
    type: 'email',
    address: 'me@example.com',
    verified: true,
    enabled: true,
  };
  const db =
    opts.db ??
    ({
      select: () => ({
        from: (table: unknown) => {
          let joined = false;
          const builder = {
            innerJoin: () => {
              joined = true;
              return builder;
            },
            where: async () => {
              if (table === schema.identities) {
                return joined ? [{ user: cannedUser }] : [emailIdentity];
              }
              if (table === schema.channels) return [emailChannel];
              return [cannedUser];
            },
          };
          return builder;
        },
      }),
      insert: () => ({
        values: () => ({
          returning: async () => [cannedUser],
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        }),
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      delete: () => ({ where: async () => undefined }),
      $count: async () => 0,
    } as unknown as Db);
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

describe('app - connect Discord', () => {
  const DISCORD_ID = '111222333444555666';

  it('bounces to sign-in when not signed in', async () => {
    const { base } = await startServer();
    const token = signDiscordLinkToken(DISCORD_ID, SECRET);
    const res = await fetch(`${base}/app/connect/discord?token=${encodeURIComponent(token)}`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app?status=signin-to-connect');
  });

  it('rejects a bad token', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/app/connect/discord?token=garbage`, {
      headers: { Cookie: COOKIE },
      redirect: 'manual',
    });
    expect(res.headers.get('location')).toBe('/app?status=badlink');
  });

  it('attaches a free Discord identity to the signed-in account', async () => {
    // identities + channels selects return [], so linkIdentity takes the fresh
    // "linked" path (no merge). users returns the signed-in account.
    const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
    const db = {
      select: () => ({
        from: (t: unknown) => ({
          where: async () => (t === schema.users ? [{ id: 1, plan: 'free' }] : []),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          inserts.push({ table, values });
          return { then: (resolve: (v: unknown) => void) => resolve(undefined) };
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      $count: async () => 0,
    } as unknown as Db;
    const { base } = await startServer({ db });
    const token = signDiscordLinkToken(DISCORD_ID, SECRET);
    const res = await fetch(`${base}/app/connect/discord?token=${encodeURIComponent(token)}`, {
      headers: { Cookie: COOKIE },
      redirect: 'manual',
    });
    expect(res.headers.get('location')).toBe('/app?status=discord-connected');
    expect(inserts.find(i => i.table === schema.identities)?.values).toMatchObject({
      userId: 1,
      provider: 'discord',
      providerUid: DISCORD_ID,
    });
  });
});

describe('app - connect Discord (needs-merge)', () => {
  const DISCORD_ID = '111222333444555666';

  it('routes a Discord id owned by another account to the merge confirm screen', async () => {
    // The discord identity already belongs to user 2, so linkIdentity returns
    // needs-merge; the handler must NOT merge silently - it redirects to the
    // confirm screen with a signed merge token instead.
    const db = {
      select: () => ({
        from: (t: unknown) => ({
          where: async () =>
            t === schema.identities
              ? [{ id: 5, userId: 2, provider: 'discord', providerUid: DISCORD_ID }]
              : t === schema.users
                ? [{ id: 1, plan: 'free' }]
                : [],
        }),
      }),
      $count: async () => 0,
    } as unknown as Db;
    const { base } = await startServer({ db });
    const token = signDiscordLinkToken(DISCORD_ID, SECRET);
    const res = await fetch(`${base}/app/connect/discord?token=${encodeURIComponent(token)}`, {
      headers: { Cookie: COOKIE },
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toMatch(/^\/app\/merge\?token=/);
  });
});

describe('app - merge confirmation', () => {
  // Summaries only need a plan and a meter count; no identities -> the label
  // falls back to "Account #n", which is fine for the render.
  const summaryDb = () =>
    ({
      select: () => ({
        from: (t: unknown) => ({
          where: async () => (t === schema.users ? [{ id: 1, plan: 'free' }] : []),
        }),
      }),
    }) as unknown as Db;

  it('renders the confirm page for a token that names the signed-in account', async () => {
    const { base } = await startServer({ db: summaryDb() });
    const token = signMergeToken(1, 2, SECRET);
    const res = await fetch(`${base}/app/merge?token=${encodeURIComponent(token)}`, {
      headers: { Cookie: COOKIE },
      redirect: 'manual',
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/Combine these two accounts/i);
  });

  it('rejects a token that does not name the signed-in account', async () => {
    const { base } = await startServer();
    const token = signMergeToken(2, 3, SECRET); // session is user 1
    const res = await fetch(`${base}/app/merge?token=${encodeURIComponent(token)}`, {
      headers: { Cookie: COOKIE },
      redirect: 'manual',
    });
    expect(res.headers.get('location')).toBe('/app?status=badlink');
  });

  it('refuses the merge POST without a CSRF token', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/app/merge`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: signMergeToken(1, 2, SECRET) }).toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app');
  });
});

describe('app - disconnect a sign-in method', () => {
  it('disconnects a provider when another identity remains', async () => {
    const deletes: unknown[] = [];
    const db = {
      select: () => ({
        from: (t: unknown) => ({
          where: async () =>
            t === schema.identities
              ? [
                  { id: 1, userId: 1, provider: 'telegram', providerUid: '5' },
                  { id: 2, userId: 1, provider: 'email', providerUid: 'a@b.com' },
                ]
              : [],
        }),
      }),
      delete: (table: unknown) => ({ where: async () => void deletes.push(table) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    } as unknown as Db;
    const { base } = await startServer({ db });
    const res = await fetch(`${base}/app/api/identities/disconnect`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'telegram' }),
    });
    expect(res.status).toBe(200);
    expect(deletes).toContain(schema.identities);
  });

  it('refuses to remove the last identity', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: async () => [{ id: 1, userId: 1, provider: 'telegram', providerUid: '5' }],
        }),
      }),
      delete: () => ({ where: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    } as unknown as Db;
    const { base } = await startServer({ db });
    const res = await fetch(`${base}/app/api/identities/disconnect`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'telegram' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown provider', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/app/api/identities/disconnect`, {
      method: 'POST',
      headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'nope' }),
    });
    expect(res.status).toBe(400);
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
