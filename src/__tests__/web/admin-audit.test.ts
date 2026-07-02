import http from 'http';
import { AddressInfo } from 'net';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db } from '../../db';
import { ServerConfig } from '../../config';
import { signAdminSession } from '../../web/admin-session';

const SECRET = 'test-secret';
const COOKIE = `pr_admin=${signAdminSession(SECRET)}`;

const auditRow = (i: number) => ({
  action: 'grant',
  targetUserId: i,
  detail: null,
  ip: '1.2.3.4',
  createdAt: new Date(),
});

// auditList runs select().from().orderBy().limit(n).offset(o); serve a slice.
function startServer(allRows: unknown[]) {
  const db = {
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: (n: number) => ({
            offset: (o: number) => Promise.resolve(allRows.slice(o, o + n)),
          }),
        }),
      }),
    }),
  } as unknown as Db;
  const scheduler = { lastCycleCompletedAt: new Date() } as unknown as Scheduler;
  const config = {
    port: 0,
    publicBaseUrl: 'http://localhost',
    adminPassword: 'x',
    adminSessionSecret: SECRET,
  } as unknown as ServerConfig;
  const server = createWebServer(db, scheduler, config, {} as unknown as SubscriptionService);
  return new Promise<{ server: http.Server; base: string }>(resolve => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

describe('/admin/api/audit pagination', () => {
  it('caps a page at PAGE_SIZE, flags hasMore, and stops on the last page', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => auditRow(i));
    const { server, base } = await startServer(rows);
    try {
      const p0 = (await (
        await fetch(`${base}/admin/api/audit?page=0`, { headers: { Cookie: COOKIE } })
      ).json()) as { entries: unknown[]; hasMore: boolean };
      expect(p0.entries).toHaveLength(25);
      expect(p0.hasMore).toBe(true);

      const p1 = (await (
        await fetch(`${base}/admin/api/audit?page=1`, { headers: { Cookie: COOKIE } })
      ).json()) as { entries: unknown[]; hasMore: boolean };
      expect(p1.entries).toHaveLength(5);
      expect(p1.hasMore).toBe(false);
    } finally {
      server.close();
    }
  });
});
