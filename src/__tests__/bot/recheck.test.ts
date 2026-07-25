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

function fakeDb(opts: { user?: unknown; meter?: unknown }) {
  return {
    select: () => ({
      from: (t: unknown) => ({
        where: async () => {
          if (t === schema.users) return opts.user ? [opts.user] : [];
          if (t === schema.meters) return opts.meter ? [opts.meter] : [];
          return [];
        },
      }),
    }),
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  } as unknown as Db;
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
  const answers: string[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === 'sendMessage') replies.push((payload as { text: string }).text);
    if (method === 'answerCallbackQuery') answers.push((payload as { text?: string }).text ?? '');
    return Promise.resolve({ ok: true, result: {} } as never);
  });
  let id = 1;
  async function recheck(meterId: number): Promise<void> {
    await bot.handleUpdate({
      update_id: id++,
      callback_query: {
        id: `cb${id}`,
        from: { id: 100, is_bot: false, first_name: 'U' },
        message: {
          message_id: 1,
          date: 0,
          chat: { id: 100, type: 'private', first_name: 'U' },
          text: 'alert',
        },
        chat_instance: 'ci',
        data: `recheck:${meterId}`,
      },
    } as never);
  }
  return { recheck, replies, answers };
}

function mockBalance(balance: number) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue({ json: async () => ({ code: 200, data: { balance } }) } as never);
}

const user = { id: 5, telegramChatId: 100, plan: 'free', tonePref: 'savage' };
const meter = {
  id: 7,
  userId: 5,
  provider: 'desco',
  accountNo: '12345678',
  meterNo: '87654321',
  nickname: null,
  lowThreshold: 150,
  criticalThreshold: 100,
};

describe('recheck callback', () => {
  let spy: jest.SpyInstance | undefined;
  afterEach(() => {
    spy?.mockRestore();
    spy = undefined;
  });

  it('celebrates when the balance is back above the low threshold', async () => {
    spy = mockBalance(612);
    const bot = makeBot(fakeDb({ user, meter }));
    await bot.recheck(7);
    expect(bot.replies.join(' ')).toMatch(/crisis averted/i);
  });

  it('roasts when the balance is still low', async () => {
    spy = mockBalance(42);
    const bot = makeBot(fakeDb({ user, meter }));
    await bot.recheck(7);
    expect(bot.replies.join(' ')).toMatch(/didn't recharge itself/i);
  });

  it("refuses a meter that isn't the caller's", async () => {
    spy = mockBalance(612);
    const bot = makeBot(fakeDb({ user, meter: null }));
    await bot.recheck(7);
    expect(bot.replies).toHaveLength(0);
    expect(bot.answers.join(' ')).toMatch(/not yours/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rate-limits after enough on-demand checks', async () => {
    spy = mockBalance(612);
    const bot = makeBot(fakeDb({ user, meter }));
    for (let i = 0; i < 7; i++) {
      await bot.recheck(7);
    }
    expect(bot.answers.join(' ')).toMatch(/breather/i);
  });
});
