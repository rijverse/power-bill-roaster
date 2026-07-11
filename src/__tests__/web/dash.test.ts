import { listen, closeServers } from '../helpers/http-server';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db } from '../../db';
import { ServerConfig } from '../../config';

// Only the /dash routes are exercised, so db/subscriptions are stubs and any
// token is invalid (no matching secret), which is exactly the expired case.
async function startServer(extra: Partial<ServerConfig> = {}) {
  const scheduler = { lastCycleCompletedAt: new Date() } as unknown as Scheduler;
  const config = {
    port: 0,
    pollIntervalHours: 6,
    dashboardSecret: 'test-secret',
    botUsername: null,
    ...extra,
  } as ServerConfig;
  const server = createWebServer({} as Db, scheduler, config, {} as unknown as SubscriptionService);
  return { base: await listen(server) };
}

afterEach(closeServers);

describe('/dash expired link', () => {
  it('renders a branded HTML page with a Telegram button for a bad token', async () => {
    const { base } = await startServer({ botUsername: 'roastbot' });
    const res = await fetch(`${base}/dash?t=bogus`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Link expired');
    expect(body).toContain('https://t.me/roastbot');
    expect(body).toContain('Open Telegram');
  });

  it('hides the Telegram button when no bot username is configured', async () => {
    const { base } = await startServer({ botUsername: null });
    const body = await (await fetch(`${base}/dash?t=bogus`)).text();
    expect(body).toContain('Link expired');
    // the copy mentions Telegram, but with no username there's no t.me button
    expect(body).not.toContain('t.me/');
  });

  it('keeps /dash/data returning JSON 401 for the SPA', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/dash/data?t=bogus`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/expired|invalid/i);
  });
});
