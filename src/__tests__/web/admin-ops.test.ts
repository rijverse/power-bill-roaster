import { listen, closeServers } from '../helpers/http-server';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db, schema } from '../../db';
import { ServerConfig } from '../../config';
import { signAdminSession, csrfFor } from '../../web/admin-session';

const SECRET = 'test-secret';
const cookieToken = signAdminSession(SECRET);
const COOKIE = `pr_admin=${cookieToken}`;
const CSRF = csrfFor(cookieToken, SECRET);

async function startServer(scheduler: unknown) {
  const inserts: { table: unknown; values: unknown }[] = [];
  const updates: unknown[] = [];
  const db = {
    update: () => ({ set: (v: unknown) => ({ where: async () => void updates.push(v) }) }),
    insert: (t: unknown) => ({
      values: async (v: unknown) => void inserts.push({ table: t, values: v }),
    }),
  } as unknown as Db;
  const config = {
    port: 0,
    publicBaseUrl: 'http://localhost',
    adminPassword: 'x',
    adminSessionSecret: SECRET,
    pollIntervalHours: 6,
  } as unknown as ServerConfig;
  const server = createWebServer(
    db,
    scheduler as Scheduler,
    config,
    {} as unknown as SubscriptionService
  );
  return { base: await listen(server), inserts, updates };
}

function post(base: string, path: string) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF },
  });
}

afterEach(closeServers);

describe('admin poll trigger', () => {
  it('runs a cycle and audits it when idle', async () => {
    const runOnce = jest.fn(async () => undefined);
    const { base, inserts } = await startServer({
      lastCycleCompletedAt: new Date(),
      isPolling: false,
      runOnce,
    });
    const r = (await (await post(base, '/admin/api/poll')).json()) as { started?: boolean };
    expect(r.started).toBe(true);
    expect(runOnce).toHaveBeenCalledTimes(1);
    const audit = inserts.find(i => i.table === schema.adminAudit);
    expect((audit?.values as { action: string }).action).toBe('poll-run');
  });

  it('reports already-running without starting a second cycle', async () => {
    const runOnce = jest.fn(async () => undefined);
    const { base } = await startServer({
      lastCycleCompletedAt: new Date(),
      isPolling: true,
      runOnce,
    });
    const r = (await (await post(base, '/admin/api/poll')).json()) as {
      alreadyRunning?: boolean;
    };
    expect(r.alreadyRunning).toBe(true);
    expect(runOnce).not.toHaveBeenCalled();
  });
});

describe('admin requeue dead letters', () => {
  const scheduler = { lastCycleCompletedAt: new Date(), isPolling: false, runOnce: async () => {} };

  it('resets a specific failed alert back to pending', async () => {
    const { base, updates } = await startServer(scheduler);
    expect((await post(base, '/admin/api/alerts/5/requeue')).status).toBe(200);
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending', attempts: 0 }));
  });

  it('requeues all failed alerts', async () => {
    const { base, updates } = await startServer(scheduler);
    expect((await post(base, '/admin/api/alerts/requeue-all')).status).toBe(200);
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending' }));
  });
});
