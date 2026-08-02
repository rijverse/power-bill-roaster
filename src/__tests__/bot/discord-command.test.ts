import { createBot } from '../../bot';
import { Db, schema } from '../../db';
import { ServerConfig } from '../../config';
import { SubscriptionService } from '../../billing';

const WEBHOOK = 'https://discord.com/api/webhooks/123456789/tok-en';

const config = {
  telegramBotToken: 'test:token',
  telegramApiRoot: null,
  billing: { provider: 'none' },
  publicBaseUrl: 'https://roast.test',
} as unknown as ServerConfig;

// Records inserts/updates so we can assert the channel upsert without a real DB.
function fakeDb(opts: { user?: unknown; channel?: unknown }) {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  let fromTable: unknown;
  const db = {
    select: () => ({
      from: (t: unknown) => {
        fromTable = t;
        const builder = {
          innerJoin: () => builder,
          where: async () => {
            // findUserByProvider joins identities -> users and reads `.user`
            if (fromTable === schema.identities) return opts.user ? [{ user: opts.user }] : [];
            if (fromTable === schema.users) return opts.user ? [opts.user] : [];
            if (fromTable === schema.channels) return opts.channel ? [opts.channel] : [];
            return [];
          },
        };
        return builder;
      },
    }),
    insert: () => ({ values: async (v: unknown) => void inserted.push(v) }),
    update: () => ({ set: (v: unknown) => ({ where: async () => void updated.push(v) }) }),
  };
  return { db: db as unknown as Db, inserted, updated };
}

// Drive a "/discord <arg>" message through the bot and collect the replies.
async function runDiscord(db: Db, arg: string, fetchImpl?: jest.Mock): Promise<string[]> {
  const bot = createBot(db, config, {} as unknown as SubscriptionService, null);
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Test',
    username: 'testbot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  } as never;
  const replies: string[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === 'sendMessage') replies.push((payload as { text: string }).text);
    return Promise.resolve({ ok: true, result: {} } as never);
  });

  const spy = jest.spyOn(globalThis, 'fetch');
  if (fetchImpl) spy.mockImplementation(fetchImpl);
  try {
    const text = `/discord ${arg}`.trimEnd();
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 100, type: 'private', first_name: 'U' },
        from: { id: 100, is_bot: false, first_name: 'U' },
        text,
        entities: [{ type: 'bot_command', offset: 0, length: 8 }],
      },
    } as never);
  } finally {
    spy.mockRestore();
  }
  return replies;
}

const user = { id: 5, telegramChatId: 100, plan: 'free' };

describe('/discord command', () => {
  it('validates the URL and refuses an obvious non-webhook', async () => {
    const { db, inserted } = fakeDb({ user });
    const okFetch = jest.fn();
    const replies = await runDiscord(db, 'https://evil.com/hook', okFetch);
    expect(replies.join(' ')).toMatch(/doesn't look like a Discord webhook/i);
    expect(okFetch).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('test-sends and upserts the channel on a valid URL', async () => {
    const { db, inserted } = fakeDb({ user });
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 204 }) as never);
    const replies = await runDiscord(db, WEBHOOK, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(inserted).toEqual([
      { userId: 5, type: 'discord', address: WEBHOOK, verified: true, enabled: true },
    ]);
    expect(replies.join(' ')).toMatch(/test message/i);
  });

  it('does not save the channel if the test send fails', async () => {
    const { db, inserted } = fakeDb({ user });
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 404 }) as never);
    const replies = await runDiscord(db, WEBHOOK, fetchImpl);
    expect(inserted).toHaveLength(0);
    expect(replies.join(' ')).toMatch(/rejected it|current/i);
  });

  it('/discord off pauses an existing channel', async () => {
    const channel = {
      id: 9,
      userId: 5,
      type: 'discord',
      address: WEBHOOK,
      verified: true,
      enabled: true,
    };
    const { db, updated } = fakeDb({ user, channel });
    const replies = await runDiscord(db, 'off');
    expect(updated).toEqual([{ enabled: false }]);
    expect(replies.join(' ')).toMatch(/paused/i);
  });
});
