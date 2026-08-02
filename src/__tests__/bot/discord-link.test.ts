import { createBot } from '../../bot';
import { Db, schema } from '../../db';
import { ServerConfig } from '../../config';
import { SubscriptionService } from '../../billing';
import { signDiscordLinkToken } from '../../web/user-auth';

const SECRET = 'test-secret';
const DISCORD_ID = '111222333444555666';
const config = {
  telegramBotToken: 'test:token',
  telegramApiRoot: null,
  dashboardSecret: SECRET,
  billing: { provider: 'none' },
  publicBaseUrl: 'https://roast.test',
} as unknown as ServerConfig;

// users selects are consumed in call order: the discord-link handler looks up
// by discord id first, then findUser by chat id. channels selects return [].
function fakeDb(usersQueue: unknown[][]) {
  let i = 0;
  const updates: unknown[] = [];
  const inserted: { table: unknown; values: Record<string, unknown> }[] = [];
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
        inserted.push({ table, values });
        return {
          returning: async () => [{ id: 42, plan: 'free', ...values }],
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
      },
    }),
  } as unknown as Db;
  return { db, updates, inserted };
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
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 100, type: 'private', first_name: 'U' },
        from: { id: 100, is_bot: false, first_name: 'U' },
        text: `/start ${payload}`,
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    } as never);
  }
  return { start, replies };
}

const tgUser = { id: 7, telegramChatId: 100, discordUserId: null, email: null, plan: 'free' };
const discordUser = { id: 9, telegramChatId: null, discordUserId: DISCORD_ID, plan: 'free' };

describe('/start link_ with a discord-link token', () => {
  it('stamps the discord id on an existing telegram account and opens the DM channel', async () => {
    // discord-id lookup: none; findUser: the telegram account
    const { db, inserted } = fakeDb([[], [tgUser]]);
    const bot = makeBot(db);
    await bot.start(`link_${signDiscordLinkToken(DISCORD_ID, SECRET)}`);
    expect(bot.replies.join(' ')).toMatch(/Linked/i);
    // the discord identity row lands (source of truth), not a users column
    expect(inserted.find(x => x.table === schema.identities)?.values).toMatchObject({
      userId: 7,
      provider: 'discord',
      providerUid: DISCORD_ID,
    });
    const channels = inserted.filter(x => x.table === schema.channels);
    expect(channels[0].values).toMatchObject({
      type: 'discord-dm',
      address: DISCORD_ID,
      verified: true,
    });
  });

  it('sends the user to sign up when neither side has an account', async () => {
    // discord-id lookup: none; findUser: none. Accounts are created on the web
    // now, so the bot links nothing and points at signup.
    const { db, updates, inserted } = fakeDb([[], []]);
    const bot = makeBot(db);
    await bot.start(`link_${signDiscordLinkToken(DISCORD_ID, SECRET)}`);
    expect(bot.replies.join(' ')).toMatch(/sign up|dashboard/i);
    expect(inserted.filter(x => x.table === schema.users)).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('attaches telegram to an existing discord-only account', async () => {
    // discord-id lookup: the discord account; findUser: none
    const { db, inserted } = fakeDb([[discordUser], []]);
    const bot = makeBot(db);
    await bot.start(`link_${signDiscordLinkToken(DISCORD_ID, SECRET)}`);
    expect(bot.replies.join(' ')).toMatch(/Linked/i);
    // telegram identity attached to the discord account (source of truth)
    expect(inserted.find(x => x.table === schema.identities)?.values).toMatchObject({
      userId: 9,
      provider: 'telegram',
      providerUid: '100',
    });
  });

  it('says already-linked when both sides are the same account', async () => {
    const linked = { ...tgUser, discordUserId: DISCORD_ID };
    const { db, updates } = fakeDb([[linked], [linked]]);
    const bot = makeBot(db);
    await bot.start(`link_${signDiscordLinkToken(DISCORD_ID, SECRET)}`);
    expect(bot.replies.join(' ')).toMatch(/already linked/i);
    expect(updates).toHaveLength(0);
  });

  it('rejects an expired discord-link token', async () => {
    const { db, updates } = fakeDb([]);
    const bot = makeBot(db);
    await bot.start(`link_${signDiscordLinkToken(DISCORD_ID, SECRET, Date.now() - 1)}`);
    expect(bot.replies.join(' ')).toMatch(/expired|isn't valid/i);
    expect(updates).toHaveLength(0);
  });
});
