import http from 'http';
import { AddressInfo } from 'net';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db } from '../../db';
import { ServerConfig } from '../../config';

// Only the /dash routes are exercised, so db/subscriptions are stubs and any
// token is invalid (no matching secret), which is exactly the expired case.
function startServer(extra: Partial<ServerConfig> = {}) {
  const scheduler = { lastCycleCompletedAt: new Date() } as unknown as Scheduler;
  const config = {
    port: 0,
    pollIntervalHours: 6,
    dashboardSecret: 'test-secret',
    botUsername: null,
    ...extra,
  } as ServerConfig;
  const server = createWebServer({} as Db, scheduler, config, {} as unknown as SubscriptionService);
  return new Promise<{ server: http.Server; base: string }>(resolve => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

describe('/dash expired link', () => {
  it('renders a branded HTML page with a Telegram button for a bad token', async () => {
    const { server, base } = await startServer({ botUsername: 'roastbot' });
    try {
      const res = await fetch(`${base}/dash?t=bogus`);
      expect(res.status).toBe(401);
      expect(res.headers.get('content-type')).toContain('text/html');
      const body = await res.text();
      expect(body).toContain('Link expired');
      expect(body).toContain('https://t.me/roastbot');
      expect(body).toContain('Open Telegram');
    } finally {
      server.close();
    }
  });

  it('hides the Telegram button when no bot username is configured', async () => {
    const { server, base } = await startServer({ botUsername: null });
    try {
      const body = await (await fetch(`${base}/dash?t=bogus`)).text();
      expect(body).toContain('Link expired');
      // the copy mentions Telegram, but with no username there's no t.me button
      expect(body).not.toContain('t.me/');
    } finally {
      server.close();
    }
  });

  it('keeps /dash/data returning JSON 401 for the SPA', async () => {
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/dash/data?t=bogus`);
      expect(res.status).toBe(401);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/expired|invalid/i);
    } finally {
      server.close();
    }
  });
});
