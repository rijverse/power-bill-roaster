import { listen, closeServers } from '../helpers/http-server';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db } from '../../db';
import { ServerConfig } from '../../config';

// The CSP script-src was once allow-listed to the whole cdn.jsdelivr.net
// origin, which a stored-XSS payload could abuse to load any jsdelivr script.
// It now pins the exact Chart.js bundle every page loads, so only that one
// file can run. These tests pin that against regressions.

async function startServer(): Promise<string> {
  const db = { execute: async () => [{ '?column?': 1 }] } as unknown as Db;
  const scheduler = { lastCycleCompletedAt: new Date() } as unknown as Scheduler;
  const config = { port: 0, pollIntervalHours: 6 } as unknown as ServerConfig;
  return listen(createWebServer(db, scheduler, config, {} as SubscriptionService));
}

afterEach(closeServers);

describe('security headers', () => {
  it('pins script-src to the exact Chart.js bundle, not the whole jsdelivr CDN', async () => {
    const base = await startServer();
    const res = await fetch(`${base}/health`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js');
    // The bare origin must not appear (that would re-open the whole CDN).
    expect(csp).not.toMatch(/script-src[^;]*https:\/\/cdn\.jsdelivr\.net(?!\/npm\/chart\.js@)/);
  });

  it('sets X-Frame-Options DENY and nosniff on every response', async () => {
    const base = await startServer();
    const res = await fetch(`${base}/health`);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sets Referrer-Policy no-referrer (hides tokens in dashboard URLs)', async () => {
    const base = await startServer();
    const res = await fetch(`${base}/health`);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});
