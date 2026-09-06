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

// Fake db covering findUser (select from users) and userMeters (join projecting
// { meter }). Enough for the onboarding paths; no writes are asserted here.
function fakeDb(opts: { user?: unknown; meters?: unknown[] }) {
  const usersRows = opts.user ? [opts.user] : [];
  const metersRows = opts.meters ?? [];
  return {
    select: () => ({
      from: (t: unknown) => {
        const builder = {
          innerJoin: () => builder,
          where: async () => {
            if (t === schema.users) return usersRows;
            if (t === schema.meters) return metersRows.map(m => ({ meter: m }));
            return [];
          },
        };
        return builder;
      },
    }),
    insert: () => ({ values: async () => undefined, onConflictDoNothing: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  } as unknown as Db;
}

interface Sent {
  text: string;
  reply_markup?: unknown;
}

// A bot whose replies we capture; send() drives one text message through it and
// state (the pending map) survives across sends on the same instance.
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
      const p = payload as { text: string; reply_markup?: unknown };
      sent.push({ text: p.text, reply_markup: p.reply_markup });
    }
    return Promise.resolve({ ok: true, result: {} } as never);
  });
  let updateId = 1;
  async function send(text: string, isCommand = false): Promise<void> {
    const message: Record<string, unknown> = {
      message_id: updateId,
      date: 0,
      chat: { id: 100, type: 'private', first_name: 'U' },
      from: { id: 100, is_bot: false, first_name: 'U' },
      text,
    };
    if (isCommand) {
      message.entities = [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }];
    }
    await bot.handleUpdate({ update_id: updateId++, message } as never);
  }
  const last = () => sent[sent.length - 1];
  return { send, sent, last };
}

const user = { id: 5, telegramChatId: 100, plan: 'free' };

// Meters are created only on the web dashboard now: the bot no longer registers
// meters or creates accounts, so free-form text is never a registration step.
describe('meter setup is dashboard-only', () => {
  it('/register points at the dashboard instead of starting a flow', async () => {
    const bot = makeBot(fakeDb({ user, meters: [] }));
    await bot.send('/register', true);
    expect(bot.last().text).toContain('https://roast.test/app');
  });

  it('a bare account number is no longer a registration step', async () => {
    const bot = makeBot(fakeDb({ user, meters: [] }));
    await bot.send('12345678');
    expect(bot.last().text).toMatch(/Not sure what you mean/i);
    expect(JSON.stringify(bot.last().reply_markup ?? '')).not.toContain('reg:');
  });

  it('ignores non-numeric text', async () => {
    const bot = makeBot(fakeDb({ user, meters: [] }));
    await bot.send('hello there');
    expect(bot.last().text).toMatch(/Not sure what you mean/i);
  });

  it('sends a brand-new chat with no account to sign up on the web', async () => {
    const bot = makeBot(fakeDb({ meters: [] }));
    await bot.send('/start', true);
    expect(bot.last().text).toContain('https://roast.test/app');
  });
});
