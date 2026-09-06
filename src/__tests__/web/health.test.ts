import { listen, closeServers } from '../helpers/http-server';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db } from '../../db';
import { ServerConfig } from '../../config';

// /health is the contract an uptime monitor watches, and it had no test at all.
// It has to go red for the two failure modes that matter: a dead database, and a
// poll loop that has silently stopped.

const HOUR = 60 * 60 * 1000;

interface Opts {
  lastCycleCompletedAt?: Date | null;
  dbOk?: boolean;
}

async function startServer(opts: Opts = {}): Promise<string> {
  const db = {
    execute: async () => {
      if (opts.dbOk === false) {
        throw new Error('postgres is gone');
      }
      return [{ '?column?': 1 }];
    },
  } as unknown as Db;
  const scheduler = {
    lastCycleCompletedAt:
      opts.lastCycleCompletedAt === undefined ? new Date() : opts.lastCycleCompletedAt,
  } as unknown as Scheduler;
  const config = { port: 0, pollIntervalHours: 6 } as unknown as ServerConfig;
  return listen(createWebServer(db, scheduler, config, {} as SubscriptionService));
}

afterEach(closeServers);

async function health(base: string) {
  const res = await fetch(`${base}/health`);
  return { status: res.status, body: (await res.json()) as { status: string } };
}

describe('/health', () => {
  it('is 200 ok right after a poll cycle', async () => {
    const { status, body } = await health(await startServer());
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('is 503 stale when the poll loop has been silent for two intervals', async () => {
    // The wedged-process case. The in-process watchdog acts on the same condition.
    const base = await startServer({ lastCycleCompletedAt: new Date(Date.now() - 13 * HOUR) });
    const { status, body } = await health(base);
    expect(status).toBe(503);
    expect(body.status).toBe('stale');
  });

  it('is 503 db-down when the database ping fails', async () => {
    // A dead postgres must flip the monitor red even though node is fine.
    const { status, body } = await health(await startServer({ dbOk: false }));
    expect(status).toBe(503);
    expect(body.status).toBe('db-down');
  });

  it('reports db-down ahead of staleness when both are true', async () => {
    const base = await startServer({
      dbOk: false,
      lastCycleCompletedAt: new Date(Date.now() - 13 * HOUR),
    });
    expect((await health(base)).body.status).toBe('db-down');
  });
});
