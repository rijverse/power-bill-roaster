import { Dispatcher, TelegramSender } from '../../notifications/dispatcher';
import { Db, schema } from '../../db';
import { MeterContext } from '../../notifications/telegram-templates';

const ctx: MeterContext = {
  nickname: null,
  accountNo: '12345678',
  meterNo: '87654321',
  balance: 42.5,
  lowThreshold: 150,
  criticalThreshold: 100,
  prediction: null,
};

// telegramChatId null so the Telegram branch is skipped; we're testing Discord.
const user = { id: 1, telegramChatId: null, plan: 'free' } as unknown as schema.User;
const meter = { id: 7 } as unknown as schema.Meter;
const WEBHOOK = 'https://discord.com/api/webhooks/1/tok';

// The dispatcher filters channels by `type` in SQL; the fake db can't run SQL,
// so recover the queried type from the drizzle condition to mimic that filter.
const CHANNEL_TYPES = ['telegram', 'email', 'sms', 'discord'];
function conditionType(cond: unknown): string | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [cond];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (typeof value === 'string' && CHANNEL_TYPES.includes(value)) return value;
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return undefined;
}

function fakeDb(discordChannels: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: async (cond: unknown) => (conditionType(cond) === 'discord' ? discordChannels : []),
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  } as unknown as Db;
}

const telegram: TelegramSender = { sendTelegram: jest.fn(async () => undefined) };

describe('Dispatcher discord branch', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('posts to a verified, enabled discord channel on a low alert', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 204 });
    const db = fakeDb([
      { id: 9, address: WEBHOOK, type: 'discord', verified: true, enabled: true },
    ]);
    const dispatcher = new Dispatcher(db, telegram, null, null);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(WEBHOOK);
    expect(result).toEqual({ delivered: ['discord:9'], failed: [] });
  });

  it('reports the channel failed (not delivered) when the webhook post fails', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });
    const db = fakeDb([
      { id: 9, address: WEBHOOK, type: 'discord', verified: true, enabled: true },
    ]);
    const dispatcher = new Dispatcher(db, telegram, null, null);

    const result = await dispatcher.dispatchAlert(user, meter, 'critical-alert', 'critical', ctx);

    expect(result).toEqual({ delivered: [], failed: ['discord:9'] });
  });

  it('skips a channel already delivered on a previous attempt', async () => {
    const db = fakeDb([
      { id: 9, address: WEBHOOK, type: 'discord', verified: true, enabled: true },
    ]);
    const dispatcher = new Dispatcher(db, telegram, null, null);

    const result = await dispatcher.dispatchAlert(
      user,
      meter,
      'low-alert',
      'low',
      ctx,
      new Set(['discord:9'])
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: [], failed: [] });
  });

  it("an isolated discord failure doesn't block another channel", async () => {
    const tgUser = { id: 1, telegramChatId: 555, plan: 'free' } as unknown as schema.User;
    fetchSpy.mockRejectedValueOnce(new Error('network'));
    const db = fakeDb([
      { id: 9, address: WEBHOOK, type: 'discord', verified: true, enabled: true },
    ]);
    const send = jest.fn(async () => undefined);
    const dispatcher = new Dispatcher(db, { sendTelegram: send }, null, null);

    const result = await dispatcher.dispatchAlert(tgUser, meter, 'low-alert', 'low', ctx);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.delivered).toContain('telegram');
    expect(result.failed).toContain('discord:9');
  });
});
