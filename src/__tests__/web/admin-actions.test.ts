import { listen, closeServers } from '../helpers/http-server';
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

async function startServer(state: State) {
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
  return { base: await listen(server), inserts, updates };
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

afterEach(closeServers);

describe('admin resume', () => {
  it('resumes oldest-first up to the plan cap and reports the rest paused', async () => {
    const { base } = await startServer({
      user: { id: 7, plan: 'free' },
      meters: [meter(1, false), meter(2, false), meter(3, false)],
    });
    const r = (await (await post(base, '/admin/api/users/7/resume')).json()) as {
      resumed: number;
      stillPaused: number;
    };
    expect(r.resumed).toBe(1); // free cap is 1, nothing active yet
    expect(r.stillPaused).toBe(2);
  });
});

describe('admin revoke', () => {
  it('downgrades, pauses excess meters, and writes an audit row', async () => {
    const { base, inserts } = await startServer({
      user: { id: 7, plan: 'plus' },
      meters: [meter(1, true), meter(2, true)],
      activeSub: { id: 5, plan: 'plus' },
    });
    const r = (await (await post(base, '/admin/api/users/7/revoke')).json()) as {
      pausedMeters: number;
    };
    expect(r.pausedMeters).toBe(1); // free cap 1, two active -> one paused
    const audit = inserts.find(i => i.table === schema.adminAudit);
    expect((audit?.values as { action: string }).action).toBe('revoke');
  });

  it('refuses when there is no active subscription', async () => {
    const { base } = await startServer({ user: { id: 7, plan: 'free' }, activeSub: null });
    const res = await post(base, '/admin/api/users/7/revoke');
    expect(res.status).toBe(400);
  });
});

describe('admin re-check', () => {
  afterEach(() => mockGetProvider.mockReset());

  it('stores a fresh reading and returns the balance', async () => {
    mockGetProvider.mockReturnValue({ getBalance: async () => ({ balance: 500 }) });
    const { base, inserts } = await startServer({
      user: { id: 7, plan: 'free' },
      meters: [meter(1, true)],
    });
    const r = (await (await post(base, '/admin/api/users/7/meters/1/recheck')).json()) as {
      balance: number;
    };
    expect(r.balance).toBe(500);
    expect(inserts.some(i => i.table === schema.readings)).toBe(true);
  });

  it('distinguishes DESCO-down (502) from bad numbers (400)', async () => {
    const { base } = await startServer({
      user: { id: 7, plan: 'free' },
      meters: [meter(1, true)],
    });
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
  });

  it('rate-limits repeated re-checks of a meter', async () => {
    mockGetProvider.mockReturnValue({ getBalance: async () => ({ balance: 1 }) });
    const { base } = await startServer({
      user: { id: 7, plan: 'free' },
      meters: [meter(1, true)],
    });
    let last = 200;
    for (let i = 0; i < 11; i++) {
      last = (await post(base, '/admin/api/users/7/meters/1/recheck')).status;
    }
    expect(last).toBe(429); // cap is 10 per window
  });
});

describe('admin grant', () => {
  it('records the operator reason in the audit detail', async () => {
    const { base, inserts } = await startServer({ user: { id: 7, plan: 'free' } });
    await post(base, '/admin/api/users/7/grant', {
      plan: 'plus',
      days: 90,
      reason: 'beta tester',
    });
    const audit = inserts.find(i => i.table === schema.adminAudit);
    const detail = (audit?.values as { detail: string }).detail;
    expect(detail).toContain('reason=beta tester');
    expect(detail).toContain('plan=plus');
  });
});
