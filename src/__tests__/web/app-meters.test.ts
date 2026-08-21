import { listen, closeServers } from '../helpers/http-server';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db, schema } from '../../db';
import { ServerConfig } from '../../config';
import { signUserSession, csrfFor } from '../../web/user-auth';

// Mock the provider layer, not global fetch - the test's own HTTP client uses fetch too.
jest.mock('../../providers', () => {
  const actual = jest.requireActual('../../providers');
  return { __esModule: true, ...actual, getProvider: jest.fn() };
});
import { getProvider } from '../../providers';
const mockGetProvider = getProvider as unknown as jest.Mock;

const SECRET = 'test-secret';
const cookieToken = signUserSession(1, SECRET);
const COOKIE = `pr_user=${cookieToken}`;
const CSRF = csrfFor(cookieToken, SECRET);

type MeterRow = Partial<schema.Meter> & { id: number; active: boolean };

function meterRow(over: Partial<MeterRow> = {}): MeterRow {
  return {
    id: 1,
    userId: 1,
    provider: 'desco',
    accountNo: '12345',
    meterNo: '67890',
    nickname: null,
    lowThreshold: 150,
    criticalThreshold: 100,
    active: true,
    ...over,
  };
}

async function startServer(state: { user?: unknown; meters?: MeterRow[] } = {}) {
  const inserts: { table: unknown; values: unknown }[] = [];
  const updates: { table: unknown; values: unknown }[] = [];
  const meters = state.meters ?? [];
  const user = state.user ?? { id: 1, plan: 'free', meterLimit: null, tonePref: 'savage' };
  const rowsFor = (t: unknown) => {
    if (t === schema.users) return [user];
    if (t === schema.meters) return meters;
    return [];
  };
  const db = {
    select: () => ({
      from: (t: unknown) => {
        const b = {
          where: () => b,
          orderBy: () => Promise.resolve(rowsFor(t)),
          then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve(rowsFor(t)).then(res, rej),
        };
        return b;
      },
    }),
    update: (t: unknown) => ({
      set: (v: unknown) => {
        const apply = () => {
          updates.push({ table: t, values: v });
          if (t === schema.meters) {
            meters.forEach(m => Object.assign(m, v));
          }
        };
        return {
          where: () => ({
            returning: async () => {
              apply();
              return meters.length ? [meters[0]] : [meterRow()];
            },
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
              apply();
              return Promise.resolve(undefined).then(res, rej);
            },
          }),
        };
      },
    }),
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        const b = {
          onConflictDoUpdate: async () => undefined,
          returning: async () => {
            inserts.push({ table: t, values: v });
            return [{ ...meterRow(), ...(v as object) }];
          },
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            inserts.push({ table: t, values: v });
            return Promise.resolve(undefined).then(res, rej);
          },
        };
        return b;
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    $count: async () => meters.filter(m => m.active).length,
  } as unknown as Db;

  const scheduler = { lastCycleCompletedAt: new Date() } as unknown as Scheduler;
  const config = {
    port: 0,
    publicBaseUrl: 'http://localhost',
    dashboardSecret: SECRET,
    defaultThresholds: { low: 150, critical: 100 },
    reminderIntervalHours: 24,
    rechargeUrl: 'https://example.test/',
  } as unknown as ServerConfig;
  const server = createWebServer(db, scheduler, config, {} as SubscriptionService, null);
  return { base: await listen(server), inserts, updates, meters };
}

const post = (base: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Cookie: COOKIE, 'X-CSRF-Token': CSRF, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

afterEach(closeServers);
afterEach(() => mockGetProvider.mockReset());

describe('add a meter', () => {
  it('keeps the balance it just fetched instead of waiting for the next poll', async () => {
    // The bug this pins: the balance was fetched to validate the numbers, echoed
    // back to the client, and thrown away. With a 6h poll interval the dashboard
    // showed 0.00 and "every meter is healthy" for the rest of the day.
    mockGetProvider.mockReturnValue({
      getBalance: async () => ({ balance: 42.5, currentMonthConsumption: 12, readingTime: 'x' }),
    });
    const { base, inserts } = await startServer();
    const res = await post(base, '/app/api/meters', { accountNo: '12345', meterNo: '67890' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, balance: 42.5 });
    const reading = inserts.find(i => i.table === schema.readings);
    expect((reading?.values as { balance: number }).balance).toBe(42.5);
  });

  it('queues the first alert straight away when that balance is already critical', async () => {
    mockGetProvider.mockReturnValue({ getBalance: async () => ({ balance: 42.5 }) });
    const { base, inserts } = await startServer();
    await post(base, '/app/api/meters', { accountNo: '12345', meterNo: '67890' });
    expect(inserts.some(i => i.table === schema.pendingAlerts)).toBe(true);
  });

  it('says "1 meter" rather than "1 meter(s)" at the cap', async () => {
    mockGetProvider.mockReturnValue({ getBalance: async () => ({ balance: 500 }) });
    const { base } = await startServer({ meters: [meterRow()] });
    const res = await post(base, '/app/api/meters', { accountNo: '99999', meterNo: '88888' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('1 meter.');
  });
});

describe('force check', () => {
  it('re-reads every active meter from the provider and stores what it finds', async () => {
    // It used to only re-render from the database, so between poll cycles the
    // button looked broken.
    mockGetProvider.mockReturnValue({ getBalance: async () => ({ balance: 77.25 }) });
    const { base, inserts } = await startServer({ meters: [meterRow()] });
    const res = await post(base, '/app/api/refresh');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checked: 1, failed: 0 });
    expect(
      (inserts.find(i => i.table === schema.readings)?.values as { balance: number }).balance
    ).toBe(77.25);
  });

  it('is a no-op with nothing to check', async () => {
    const { base } = await startServer({ meters: [] });
    const res = await post(base, '/app/api/refresh');
    expect(await res.json()).toEqual({ ok: true, checked: 0, failed: 0 });
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  it('reports upstream trouble rather than a false success', async () => {
    mockGetProvider.mockReturnValue({
      getBalance: async () => {
        throw new Error('desco down');
      },
    });
    const { base } = await startServer({ meters: [meterRow()] });
    expect((await post(base, '/app/api/refresh')).status).toBe(502);
  });

  it('needs the CSRF token like every other mutation', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/app/api/refresh`, {
      method: 'POST',
      headers: { Cookie: COOKIE },
    });
    expect(res.status).toBe(403);
  });
});

describe('resume a paused meter', () => {
  it('reactivates it, so a pause is not a one-way door', async () => {
    const { base, updates } = await startServer({ meters: [meterRow({ active: false })] });
    const res = await post(base, '/app/api/meters/1/resume');

    expect(res.status).toBe(200);
    expect(
      updates.some(u => u.table === schema.meters && (u.values as { active: boolean }).active)
    ).toBe(true);
  });

  it('refuses when the plan cap is already full', async () => {
    // resume has to count against the cap or pause/resume is a way around it
    const { base } = await startServer({
      meters: [meterRow({ id: 1, active: true }), meterRow({ id: 2, active: false })],
    });
    const res = await post(base, '/app/api/meters/2/resume');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Pause another one first');
  });
});
