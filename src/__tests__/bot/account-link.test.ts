import { createBot } from '../../bot';
import { Db, schema } from '../../db';
import { ServerConfig } from '../../config';
import { SubscriptionService } from '../../billing';
import { signLinkToken } from '../../web/user-auth';

const SECRET = 'test-secret';
const config = {
  telegramBotToken: 'test:token',
  telegramApiRoot: null,
  dashboardSecret: SECRET,
  billing: { provider: 'none' },
  publicBaseUrl: 'https://roast.test',
} as unknown as ServerConfig;

// users selects are consumed in call order: the handler looks up the web user by
// id first, then the bot user by chat id (findUser).
function fakeDb(usersQueue: unknown[][]) {
  let i = 0;
  const updates: unknown[] = [];
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const db = {
    select: () => ({
      from: (t: unknown) => {
        const builder = {
          innerJoin: () => builder,
          // findUserByProvider joins identities -> users and reads `.user`
          where: async () => {
            if (t === schema.identities) return (usersQueue[i++] ?? []).map(r => ({ user: r }));
            if (t === schema.users) return usersQueue[i++] ?? [];
            return [];
          },
        };
        return builder;
      },
    }),
    update: () => ({ set: (v: unknown) => ({ where: async () => void updates.push(v) }) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return { then: (resolve: (v: unknown) => void) => resolve(undefined) };
      },
    }),
  } as unknown as Db;
  return { db, updates, inserts };
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
  const replies: string[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === 'sendMessage') replies.push((payload as { text: string }).text);
    return Promise.resolve({ ok: true, result: {} } as never);
  });
  async function start(payload: string): Promise<void> {
    const text = `/start ${payload}`.trimEnd();
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 100, type: 'private', first_name: 'U' },
        from: { id: 100, is_bot: false, first_name: 'U' },
        text,
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    } as never);
  }
  return { start, replies };
}

const webUser = { id: 9, telegramChatId: null, email: 'w@e.com', plan: 'free' };

describe('/start link_ payload', () => {
  it('links the chat to the web account when the chat has no account yet', async () => {
    // web-user lookup returns the account; findUser returns none
    const { db, inserts } = fakeDb([[webUser], []]);
    const bot = makeBot(db);
    await bot.start(`link_${signLinkToken(9, SECRET)}`);
    expect(bot.replies.join(' ')).toMatch(/Linked/i);
    // linking writes the identity row (the source of truth), not a users column
    expect(inserts.find(x => x.table === schema.identities)?.values).toMatchObject({
      userId: 9,
      provider: 'telegram',
      providerUid: '100',
    });
  });

  it('reports an expired/invalid link without touching the db', async () => {
    const { db } = fakeDb([]);
    const bot = makeBot(db);
    await bot.start(`link_${signLinkToken(9, SECRET, Date.now() - 1)}`);
    expect(bot.replies.join(' ')).toMatch(/expired|isn't valid/i);
  });

  it('says already-linked when the chat is the same account', async () => {
    const linked = { id: 9, telegramChatId: 100, email: 'w@e.com', plan: 'free' };
    // web lookup + findUser both return the same account
    const { db } = fakeDb([[linked], [linked]]);
    const bot = makeBot(db);
    await bot.start(`link_${signLinkToken(9, SECRET)}`);
    expect(bot.replies.join(' ')).toMatch(/already linked/i);
  });

  it('falls through to the normal welcome without a link payload', async () => {
    const { db } = fakeDb([[]]);
    const bot = makeBot(db);
    await bot.start('');
    expect(bot.replies.join(' ')).toMatch(/Welcome to Power Roast/i);
  });
});
