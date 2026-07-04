import { Dispatcher, TelegramSender, DiscordDmSender } from '../../notifications/dispatcher';
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

// telegramChatId null so the Telegram branch is skipped; we're testing DMs.
const user = { id: 1, telegramChatId: null, plan: 'free' } as unknown as schema.User;
const meter = { id: 7 } as unknown as schema.Meter;
const DISCORD_USER_ID = '111222333444555666';

// Same trick as the webhook test: the fake db can't run SQL, so recover the
// channel type the dispatcher asked for from the drizzle condition object.
const CHANNEL_TYPES = ['telegram', 'email', 'sms', 'discord', 'discord-dm'];
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

function fakeDb(dmChannels: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: async (cond: unknown) => (conditionType(cond) === 'discord-dm' ? dmChannels : []),
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  } as unknown as Db;
}

const telegram: TelegramSender = { sendTelegram: jest.fn(async () => undefined) };
const dmChannel = {
  id: 5,
  address: DISCORD_USER_ID,
  type: 'discord-dm',
  verified: true,
  enabled: true,
};

describe('Dispatcher discord-dm branch', () => {
  it('DMs a verified, enabled discord-dm channel on a low alert', async () => {
    const sendDm = jest.fn(async (_userId: string) => undefined);
    const dm: DiscordDmSender = { sendDm };
    const dispatcher = new Dispatcher(fakeDb([dmChannel]), telegram, null, null, dm);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(sendDm).toHaveBeenCalledTimes(1);
    expect(sendDm.mock.calls[0][0]).toBe(DISCORD_USER_ID);
    expect(result).toEqual({ delivered: ['discord-dm:5'], failed: [] });
  });

  it('reports the channel failed when the DM is rejected (e.g. closed DMs)', async () => {
    const dm: DiscordDmSender = {
      sendDm: jest.fn(async () => {
        throw new Error('Discord API POST /channels returned 403');
      }),
    };
    const dispatcher = new Dispatcher(fakeDb([dmChannel]), telegram, null, null, dm);

    const result = await dispatcher.dispatchAlert(user, meter, 'critical-alert', 'critical', ctx);

    expect(result).toEqual({ delivered: [], failed: ['discord-dm:5'] });
  });

  it('skips a DM already delivered on a previous attempt', async () => {
    const sendDm = jest.fn(async () => undefined);
    const dispatcher = new Dispatcher(fakeDb([dmChannel]), telegram, null, null, { sendDm });

    const result = await dispatcher.dispatchAlert(
      user,
      meter,
      'low-alert',
      'low',
      ctx,
      new Set(['discord-dm:5'])
    );

    expect(sendDm).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: [], failed: [] });
  });

  it('is silent when no DM sender is configured (Discord bot off)', async () => {
    const dispatcher = new Dispatcher(fakeDb([dmChannel]), telegram, null, null, null);
    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);
    expect(result).toEqual({ delivered: [], failed: [] });
  });
});
