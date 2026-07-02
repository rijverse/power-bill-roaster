import http from 'http';
import { AddressInfo } from 'net';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db, schema } from '../../db';
import { ServerConfig } from '../../config';
import { signAdminSession, csrfFor } from '../../web/admin-session';

// Mock the provider layer, not global fetch - the test's own HTTP client uses fetch too.
jest.mock('../../providers', () => {
  const actual = jest.requireActual('../../providers');
  return { __esModule: true, ...actual, getProvider: jest.fn() };
});
import { getProvider, ProviderUnavailableError } from '../../providers';
const mockGetProvider = getProvider as unknown as jest.Mock;

const SECRET = 'test-secret';
const cookieToken = signAdminSession(SECRET);
const COOKIE = `pr_admin=${cookieToken}`;
const CSRF = csrfFor(cookieToken, SECRET);

interface State {
  user?: unknown;
  meters?: {
    id: number;
    active: boolean;
    provider?: string;
    accountNo?: string;
    meterNo?: string;
  }[];
  activeSub?: unknown;
}

// A drizzle-ish query result that is both awaitable and chainable (.where/.orderBy).
function q(rows: unknown[]) {
  const b = {
    where: () => b,
    orderBy: () => Promise.resolve(rows),
    then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej),
  };
  return b;
}

function startServer(state: State) {
  const inserts: { table: unknown; values: unknown }[] = [];
  const updates: { values: unknown }[] = [];
  const meters = state.meters ?? [];
  const rowsFor = (t: unknown) => {
    if (t === schema.users) return state.user ? [state.user] : [];
    if (t === schema.meters) return meters;
    return [];
  };
  const db = {
    select: () => ({ from: (t: unknown) => q(rowsFor(t)) }),
    update: () => ({ set: (v: unknown) => ({ where: async () => updates.push({ values: v }) }) }),
    insert: (t: unknown) => ({
      values: async (v: unknown) => void inserts.push({ table: t, values: v }),
    }),
    $count: async () => meters.filter(m => m.active).length,
  } as unknown as Db;
  const subscriptions = {
    activeFor: async () => state.activeSub ?? null,
    grant: jest.fn(async () => undefined),
  } as unknown as SubscriptionService;
  const scheduler = { lastCycleCompletedAt: new Date() } as unknown as Scheduler;
  const config = {
    port: 0,
    publicBaseUrl: 'http://localhost',
    adminPassword: 'x',
    adminSessionSecret: SECRET,
  } as unknown as ServerConfig;
  const server = createWebServer(db, scheduler, config, subscriptions);
  return new Promise<{
    server: http.Server;
    base: string;
    inserts: typeof inserts;
    updates: typeof updates;
  }>(resolve => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}`, inserts, updates });
    });
  });
}

function post(base: string, path: string, body?: unknown) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE, 'X-CSRF-Token': CSRF },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const meter = (id: number, active: boolean) => ({
  id,
  active,
  provider: 'desco',
  accountNo: 'A' + id,
  meterNo: 'M' + id,
});

describe('admin resume', () => {
  it('resumes oldest-first up to the plan cap and reports the rest paused', async () => {
    const { server, base } = await startServer({
      user: { id: 7, plan: 'free' },
      meters: [meter(1, false), meter(2, false), meter(3, false)],
    });
    try {
      const r = (await (await post(base, '/admin/api/users/7/resume')).json()) as {
        resumed: number;
        stillPaused: number;
      };
      expect(r.resumed).toBe(1); // free cap is 1, nothing active yet
      expect(r.stillPaused).toBe(2);
    } finally {
      server.close();
    }
  });
});

describe('admin revoke', () => {
  it('downgrades, pauses excess meters, and writes an audit row', async () => {
    const { server, base, inserts } = await startServer({
      user: { id: 7, plan: 'plus' },
      meters: [meter(1, true), meter(2, true)],
      activeSub: { id: 5, plan: 'plus' },
    });
    try {
      const r = (await (await post(base, '/admin/api/users/7/revoke')).json()) as {
        pausedMeters: number;
      };
      expect(r.pausedMeters).toBe(1); // free cap 1, two active -> one paused
      const audit = inserts.find(i => i.table === schema.adminAudit);
      expect((audit?.values as { action: string }).action).toBe('revoke');
    } finally {
      server.close();
    }
  });

  it('refuses when there is no active subscription', async () => {
    const { server, base } = await startServer({ user: { id: 7, plan: 'free' }, activeSub: null });
    try {
      const res = await post(base, '/admin/api/users/7/revoke');
      expect(res.status).toBe(400);
    } finally {
      server.close();
    }
  });
});

describe('admin re-check', () => {
  afterEach(() => mockGetProvider.mockReset());

  it('stores a fresh reading and returns the balance', async () => {
    mockGetProvider.mockReturnValue({ getBalance: async () => ({ balance: 500 }) });
    const { server, base, inserts } = await startServer({
      user: { id: 7, plan: 'free' },
      meters: [meter(1, true)],
    });
    try {
      const r = (await (await post(base, '/admin/api/users/7/meters/1/recheck')).json()) as {
        balance: number;
      };
      expect(r.balance).toBe(500);
      expect(inserts.some(i => i.table === schema.readings)).toBe(true);
    } finally {
      server.close();
    }
  });

  it('distinguishes DESCO-down (502) from bad numbers (400)', async () => {
    const { server, base } = await startServer({
      user: { id: 7, plan: 'free' },
      meters: [meter(1, true)],
    });
    try {
      mockGetProvider.mockReturnValue({
        getBalance: async () => {
          throw new ProviderUnavailableError('down');
        },
      });
      expect((await post(base, '/admin/api/users/7/meters/1/recheck')).status).toBe(502);
      mockGetProvider.mockReturnValue({
        getBalance: async () => {
          throw new Error('bad numbers');
        },
      });
      expect((await post(base, '/admin/api/users/7/meters/1/recheck')).status).toBe(400);
    } finally {
      server.close();
    }
  });

  it('rate-limits repeated re-checks of a meter', async () => {
    mockGetProvider.mockReturnValue({ getBalance: async () => ({ balance: 1 }) });
    const { server, base } = await startServer({
      user: { id: 7, plan: 'free' },
      meters: [meter(1, true)],
    });
    try {
      let last = 200;
      for (let i = 0; i < 11; i++) {
        last = (await post(base, '/admin/api/users/7/meters/1/recheck')).status;
      }
      expect(last).toBe(429); // cap is 10 per window
    } finally {
      server.close();
    }
  });
});

describe('admin grant', () => {
  it('records the operator reason in the audit detail', async () => {
    const { server, base, inserts } = await startServer({ user: { id: 7, plan: 'free' } });
    try {
      await post(base, '/admin/api/users/7/grant', {
        plan: 'plus',
        days: 90,
        reason: 'beta tester',
      });
      const audit = inserts.find(i => i.table === schema.adminAudit);
      const detail = (audit?.values as { detail: string }).detail;
      expect(detail).toContain('reason=beta tester');
      expect(detail).toContain('plan=plus');
    } finally {
      server.close();
    }
  });
});
