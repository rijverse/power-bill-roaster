import type http from 'http';
import { listen, closeServers } from '../helpers/http-server';
import type { Db } from '../../db';
import type { ServerConfig } from '../../config';
import type { Mailer } from '../../services/mailer';
import type { Scheduler } from '../../core/scheduler';
import type { SubscriptionService } from '../../billing';
import { magicCode } from '../../web/user-auth';

// The sign-in code is stateless - derived from (email, 10-minute bucket, secret)
// - so it can be attacked against an address that never asked to sign in, and a
// correct guess mints a 30-day session. The attempt budget is the whole defence,
// which is why it must not hang off a value the caller writes.
//
// TRUST_PROXY is read at import time, so this suite loads the server after
// setting it. Keep it in its own file: resetting the registry mid-suite would
// fight the module-level mocks elsewhere.

const SECRET = 'test-secret';
const EMAIL = 'victim@example.com';

async function startServer() {
  process.env.TRUST_PROXY = '1';
  jest.resetModules();
  const { createWebServer } = await import('../../web/server');

  const db = {
    select: () => ({
      from: () => {
        const builder = { innerJoin: () => builder, where: async () => [] };
        return builder;
      },
    }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: 1, plan: 'free' }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    $count: async () => 0,
  } as unknown as Db;
  const scheduler = { lastCycleCompletedAt: new Date() } as unknown as Scheduler;
  const config = {
    port: 0,
    publicBaseUrl: 'http://localhost',
    dashboardSecret: SECRET,
  } as unknown as ServerConfig;
  const mailer = { from: 'x@y.z', send: jest.fn(async () => undefined) } as unknown as Mailer;

  const server: http.Server = createWebServer(
    db,
    scheduler,
    config,
    {} as SubscriptionService,
    mailer
  );
  return listen(server);
}

/** A code attempt that claims to come from `ip`, the way a spoofed header would. */
function attempt(base: string, code: string, ip: string) {
  return fetch(`${base}/app/login/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Caddy would append its peer address after this; the app must key off
      // that trailing hop, not this one.
      'X-Forwarded-For': ip,
    },
    body: new URLSearchParams({ email: EMAIL, code }).toString(),
    redirect: 'manual',
  });
}

afterEach(closeServers);
afterEach(() => {
  delete process.env.TRUST_PROXY;
});

describe('sign-in code brute force', () => {
  it('stops guessing at one address even when every attempt claims a new IP', async () => {
    const base = await startServer();

    // Ten wrong guesses, each from a different claimed address. The email+ip key
    // never repeats, so only the email-keyed budget can stop these.
    for (let i = 0; i < 10; i++) {
      const res = await attempt(base, '111111', `203.0.113.${i}`);
      expect(res.headers.get('location')).toBe('/app?status=badcode');
    }

    const res = await attempt(base, '111111', '203.0.113.99');
    expect(res.headers.get('location')).toBe('/app?status=ratelimited');
  }, 20000);

  it('refuses even the right code once the budget is spent', async () => {
    const base = await startServer();
    for (let i = 0; i < 10; i++) {
      await attempt(base, '111111', `198.51.100.${i}`);
    }

    // The limiter has to run ahead of verification, or a guesser who lands the
    // code on the attempt that trips the cap still gets in.
    const res = await attempt(base, magicCode(EMAIL, SECRET), '198.51.100.99');
    expect(res.headers.get('location')).toBe('/app?status=ratelimited');
    expect(res.headers.get('set-cookie')).toBeNull();
  }, 20000);
});
