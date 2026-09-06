import { createBot } from '../../bot';
import { Db, schema } from '../../db';
import { ServerConfig } from '../../config';
import { SubscriptionService } from '../../billing';

const config = {
  telegramBotToken: 'test:token',
  telegramApiRoot: null,
  billing: { provider: 'none' },
  publicBaseUrl: 'https://roast.test',
} as unknown as ServerConfig;

function fakeDb(opts: { user?: unknown } = {}) {
  const usersRows = opts.user ? [opts.user] : [];
  return {
    select: () => ({
      from: (t: unknown) => ({
        innerJoin: () => ({ where: async () => (t === schema.users ? usersRows : []) }),
      }),
    }),
  } as unknown as Db;
}

interface Sent {
  text: string;
}

function makeBot(db: Db) {
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
  const sent: Sent[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === 'sendMessage') {
      sent.push({ text: (payload as { text: string }).text });
    }
    return Promise.resolve({ ok: true, result: {} } as never);
  });
  let updateId = 1;
  async function send(text: string): Promise<void> {
    const message: Record<string, unknown> = {
      message_id: updateId,
      date: 0,
      chat: { id: 100, type: 'private', first_name: 'U' },
      from: { id: 100, is_bot: false, first_name: 'U' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
    };
    await bot.handleUpdate({ update_id: updateId++, message } as never);
  }
  return { send, last: () => sent[sent.length - 1] };
}

const user = { id: 5, telegramChatId: 100, plan: 'free' };

describe('/privacy text', () => {
  it('discloses the audit-log retention instead of claiming every byte is erased', async () => {
    const bot = makeBot(fakeDb({ user }));
    await bot.send('/privacy');
    const text = bot.last().text;

    // The old copy claimed "every byte of your data", which was untrue because
    // admin_audit rows survive /delete. The new copy must disclose the audit log.
    expect(text).not.toMatch(/every byte/);
    expect(text).toMatch(/audit log/i);
    expect(text).toMatch(/monitoring data/);
  });
});
