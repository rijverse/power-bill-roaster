import { Dispatcher, TelegramSender } from '../../notifications/dispatcher';
import { schema } from '../../db';
import { MeterContext } from '../../notifications/alert-copy';
import { channel, fakeChannelsDb } from '../helpers/channels-db';

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
    const db = fakeChannelsDb([channel({ id: 9, type: 'discord', address: WEBHOOK })]);
    const dispatcher = new Dispatcher(db, telegram, null, null);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(WEBHOOK);
    expect(result).toEqual({ delivered: ['discord:9'], failed: [] });
  });

  it('reports the channel failed (not delivered) when the webhook post fails', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });
    const db = fakeChannelsDb([channel({ id: 9, type: 'discord', address: WEBHOOK })]);
    const dispatcher = new Dispatcher(db, telegram, null, null);

    const result = await dispatcher.dispatchAlert(user, meter, 'critical-alert', 'critical', ctx);

    expect(result).toEqual({ delivered: [], failed: ['discord:9'] });
  });

  it('skips a channel already delivered on a previous attempt', async () => {
    const db = fakeChannelsDb([channel({ id: 9, type: 'discord', address: WEBHOOK })]);
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
    const db = fakeChannelsDb([channel({ id: 9, type: 'discord', address: WEBHOOK })]);
    const send = jest.fn(async () => undefined);
    const dispatcher = new Dispatcher(db, { sendTelegram: send }, null, null);

    const result = await dispatcher.dispatchAlert(tgUser, meter, 'low-alert', 'low', ctx);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.delivered).toContain('telegram');
    expect(result.failed).toContain('discord:9');
  });
});
