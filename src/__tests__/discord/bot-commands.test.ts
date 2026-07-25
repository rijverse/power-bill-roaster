import { createDiscordBot, Interaction } from '../../discord/bot';
import { Db, schema } from '../../db';
import { ServerConfig } from '../../config';
import { SubscriptionService } from '../../billing';
import { verifyDiscordLinkToken } from '../../web/user-auth';

const config = {
  telegramBotToken: 'test:token',
  publicBaseUrl: 'http://localhost:3000',
  dashboardSecret: 'secret',
  pollIntervalHours: 6,
  defaultThresholds: { low: 150, critical: 100 },
  billing: { provider: 'none' },
} as unknown as ServerConfig;

const subscriptions = {
  activeFor: async () => null,
} as unknown as SubscriptionService;

interface FakeDbState {
  users?: Record<string, unknown>[];
  meters?: Record<string, unknown>[];
  channels?: Record<string, unknown>[];
}

// Table-aware fake: routes select/insert/update by the drizzle table object
// and records writes so tests can assert on them.
function fakeDb(state: FakeDbState) {
  const inserted: { table: unknown; values: Record<string, unknown> }[] = [];
  const updated: { table: unknown; values: Record<string, unknown> }[] = [];
  const rowsFor = (table: unknown): Record<string, unknown>[] => {
    if (table === schema.users) return state.users ?? [];
    if (table === schema.meters) return state.meters ?? [];
    if (table === schema.channels) return state.channels ?? [];
    return [];
  };
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const result = {
          where: async () => rowsFor(table),
        };
        return result;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return {
          returning: async () => [{ id: 42, plan: 'free', ...values }],
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => void updated.push({ table, values }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    delete: (table: unknown) => ({
      where: async () => void inserted.push({ table: 'deleted', values: { table } }),
    }),
  };
  return { db: db as unknown as Db, inserted, updated };
}

function command(
  name: string,
  options: { name: string; value: string | number }[] = [],
  userId = '111222333444555666'
): Interaction {
  return {
    type: 2,
    token: 'itoken',
    data: { name, options },
    user: { id: userId },
  };
}

const USER = { id: 1, discordUserId: '111222333444555666', plan: 'free', tonePref: 'roast' };
const METER = {
  id: 7,
  userId: 1,
  provider: 'desco',
  accountNo: '12345678',
  meterNo: '87654321',
  nickname: null,
  lowThreshold: 150,
  criticalThreshold: 100,
  active: true,
};

function contentOf(reply: { immediate: Record<string, unknown> }): string {
  return (reply.immediate.data as { content?: string })?.content ?? '';
}

describe('Discord bot commands', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('answers PING with PONG', async () => {
    const bot = createDiscordBot(fakeDb({}).db, config, subscriptions);
    const reply = await bot.handleInteraction({ type: 1 });
    expect(reply.immediate).toEqual({ type: 1 });
  });

  it('every command reply is ephemeral', async () => {
    const bot = createDiscordBot(fakeDb({}).db, config, subscriptions);
    const reply = await bot.handleInteraction(command('help'));
    expect((reply.immediate.data as { flags: number }).flags).toBe(64);
  });

  it('/help lists the dashboard-first commands', async () => {
    const bot = createDiscordBot(fakeDb({}).db, config, subscriptions);
    const reply = await bot.handleInteraction(command('help'));
    expect(contentOf(reply)).toContain('/balance');
    expect(contentOf(reply)).not.toContain('/register');
  });

  it('unknown commands get a pointer to /help', async () => {
    const bot = createDiscordBot(fakeDb({}).db, config, subscriptions);
    const reply = await bot.handleInteraction(command('upgrade'));
    expect(contentOf(reply)).toContain('/help');
  });

  it('meter management commands are gone from Discord (managed on the web now)', async () => {
    // register / threshold / nickname were removed from the command set, so an
    // invocation falls through to the unknown-command pointer and never writes.
    const { db, inserted, updated } = fakeDb({ users: [USER], meters: [METER] });
    const bot = createDiscordBot(db, config, subscriptions);
    for (const name of ['register', 'threshold', 'nickname']) {
      const reply = await bot.handleInteraction(command(name));
      expect(contentOf(reply)).toContain('/help');
    }
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a command with no account points at the dashboard signup', async () => {
    const bot = createDiscordBot(fakeDb({}).db, config, subscriptions);
    const reply = await bot.handleInteraction(command('dashboard'));
    expect(contentOf(reply)).toContain('http://localhost:3000/app');
  });

  it('/delete without CONFIRM warns and erases nothing', async () => {
    const { db, inserted } = fakeDb({ users: [USER] });
    const bot = createDiscordBot(db, config, subscriptions);
    const reply = await bot.handleInteraction(
      command('delete', [{ name: 'confirm', value: 'yes' }])
    );
    expect(contentOf(reply)).toContain('CONFIRM');
    expect(inserted.filter(i => i.table === 'deleted')).toHaveLength(0);
  });

  it('/delete CONFIRM erases the account', async () => {
    const { db, inserted } = fakeDb({ users: [USER], meters: [METER] });
    const bot = createDiscordBot(db, config, subscriptions);
    const reply = await bot.handleInteraction(
      command('delete', [{ name: 'confirm', value: 'CONFIRM' }])
    );
    expect(contentOf(reply)).toContain('erased');
    expect(inserted.filter(i => i.table === 'deleted').length).toBeGreaterThan(0);
  });

  it('/dashboard returns a signed link', async () => {
    const { db } = fakeDb({ users: [USER] });
    const bot = createDiscordBot(db, config, subscriptions);
    const reply = await bot.handleInteraction(command('dashboard'));
    expect(contentOf(reply)).toContain('http://localhost:3000/dash?t=');
  });

  it('/tone flips the preference', async () => {
    const { db, updated } = fakeDb({ users: [USER] });
    const bot = createDiscordBot(db, config, subscriptions);
    const reply = await bot.handleInteraction(command('tone', [{ name: 'style', value: 'mild' }]));
    expect(contentOf(reply)).toContain('mild');
    expect(updated).toEqual([{ table: schema.users, values: { tonePref: 'mild' } }]);
  });

  it('/stop pauses all meters', async () => {
    const { db, updated } = fakeDb({ users: [USER], meters: [METER] });
    const bot = createDiscordBot(db, config, subscriptions);
    const reply = await bot.handleInteraction(command('stop'));
    expect(contentOf(reply)).toContain('paused');
    expect(updated).toEqual([{ table: schema.meters, values: { active: false } }]);
  });

  it('/connect hands out a web connect link with a valid discord-link token', async () => {
    const bot = createDiscordBot(fakeDb({}).db, config, subscriptions);
    const reply = await bot.handleInteraction(command('connect'));
    const content = contentOf(reply);
    expect(content).toContain('http://localhost:3000/app/connect/discord?token=');
    const token = /token=([\w.~-]+)/.exec(content)?.[1];
    expect(token).toBeTruthy();
    expect(verifyDiscordLinkToken(token!, 'secret')).toBe('111222333444555666');
  });

  it('/webhook with a bad URL is rejected without a test send', async () => {
    const { db } = fakeDb({ users: [USER] });
    const bot = createDiscordBot(db, config, subscriptions);
    const reply = await bot.handleInteraction(
      command('webhook', [{ name: 'url', value: 'https://evil.example/hook' }])
    );
    expect(contentOf(reply)).toContain("doesn't look like");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('/webhook with a valid URL test-sends then saves the channel', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 204 });
    const url = 'https://discord.com/api/webhooks/123456789/tok-en';
    const { db, inserted } = fakeDb({ users: [USER] });
    const bot = createDiscordBot(db, config, subscriptions);
    const reply = await bot.handleInteraction(command('webhook', [{ name: 'url', value: url }]));
    const payload = await reply.followUp!();
    expect(payload.content).toContain('✅');
    expect(fetchSpy.mock.calls[0][0]).toBe(url);
    const channels = inserted.filter(i => i.table === schema.channels);
    expect(channels[0].values).toMatchObject({ type: 'discord', address: url, verified: true });
  });
});
