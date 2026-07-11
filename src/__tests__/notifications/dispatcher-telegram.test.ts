import { Dispatcher, TelegramSender } from '../../notifications/dispatcher';
import { schema } from '../../db';
import { MeterContext } from '../../notifications/alert-copy';
import { channel, fakeChannelsDb } from '../helpers/channels-db';

// The Telegram branch had no test at all, which made the fan-out refactor far
// more dangerous than it looked: Telegram is the one channel that deliberately
// does NOT filter on `verified`, and a shared "enabled + verified" helper would
// have silently stopped delivering to every Telegram user.

const ctx: MeterContext = {
  nickname: null,
  accountNo: '12345678',
  meterNo: '87654321',
  balance: 42.5,
  lowThreshold: 150,
  criticalThreshold: 100,
  prediction: null,
};

const user = { id: 1, telegramChatId: 555, plan: 'free' } as unknown as schema.User;
const meter = { id: 7 } as unknown as schema.Meter;

function sender(): TelegramSender {
  return { sendTelegram: jest.fn(async () => undefined) };
}

describe('Dispatcher telegram branch', () => {
  it('delivers to an UNVERIFIED telegram row - talking to the bot is the verification', async () => {
    // The load-bearing case. A telegram channel row is never `verified` in the OTP
    // sense; requiring it here would mute every Telegram user.
    const db = fakeChannelsDb([channel({ id: 3, type: 'telegram', verified: false })]);
    const telegram = sender();
    const dispatcher = new Dispatcher(db, telegram, null, null);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(telegram.sendTelegram).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ delivered: ['telegram'], failed: [] });
  });

  it('delivers when there is no telegram channel row at all (rides telegramChatId)', async () => {
    const telegram = sender();
    const dispatcher = new Dispatcher(fakeChannelsDb([]), telegram, null, null);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(telegram.sendTelegram).toHaveBeenCalledTimes(1);
    expect(result.delivered).toEqual(['telegram']);
  });

  it('respects an explicitly disabled telegram row', async () => {
    const db = fakeChannelsDb([channel({ id: 3, type: 'telegram', enabled: false })]);
    const telegram = sender();
    const dispatcher = new Dispatcher(db, telegram, null, null);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(telegram.sendTelegram).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: [], failed: [] });
  });

  it('lets the oldest row decide when a merge left two', async () => {
    // Oldest id wins, deterministically - here the older row is disabled, so the
    // newer enabled one must not resurrect delivery.
    const db = fakeChannelsDb([
      channel({ id: 9, type: 'telegram', enabled: true }),
      channel({ id: 4, type: 'telegram', enabled: false }),
    ]);
    const telegram = sender();
    const dispatcher = new Dispatcher(db, telegram, null, null);

    await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(telegram.sendTelegram).not.toHaveBeenCalled();
  });

  it('sends nothing when the user has no telegramChatId', async () => {
    const noChat = { ...user, telegramChatId: null } as unknown as schema.User;
    const telegram = sender();
    const dispatcher = new Dispatcher(fakeChannelsDb([]), telegram, null, null);

    const result = await dispatcher.dispatchAlert(noChat, meter, 'low-alert', 'low', ctx);

    expect(telegram.sendTelegram).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: [], failed: [] });
  });

  it('does not resend a key already delivered on a previous attempt', async () => {
    const telegram = sender();
    const dispatcher = new Dispatcher(fakeChannelsDb([]), telegram, null, null);

    const result = await dispatcher.dispatchAlert(
      user,
      meter,
      'low-alert',
      'low',
      ctx,
      new Set(['telegram'])
    );

    expect(telegram.sendTelegram).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: [], failed: [] });
  });

  it('reports a failed send under the telegram key so the outbox retries it', async () => {
    const telegram: TelegramSender = {
      sendTelegram: jest.fn(async () => {
        throw new Error('telegram down');
      }),
    };
    const dispatcher = new Dispatcher(fakeChannelsDb([]), telegram, null, null);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(result).toEqual({ delivered: [], failed: ['telegram'] });
  });

  describe('buttons', () => {
    const buttonsFor = async (action: 'low-alert' | 'reminder' | 'recovery') => {
      const telegram = sender();
      const dispatcher = new Dispatcher(fakeChannelsDb([]), telegram, null, null);
      await dispatcher.dispatchAlert(user, meter, action, 'low', ctx);
      return (telegram.sendTelegram as jest.Mock).mock.calls[0]?.[2];
    };

    it('gives low alerts a recharge link, a re-check and a snooze', async () => {
      const buttons = await buttonsFor('low-alert');
      const labels = (buttons as { text: string }[][]).flat().map(b => b.text);
      expect(labels).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Recharge'),
          expect.stringContaining('Check again'),
          expect.stringContaining('Snooze'),
        ])
      );
    });

    it('omits the re-check button on a reminder but keeps snooze', async () => {
      const labels = ((await buttonsFor('reminder')) as { text: string }[][])
        .flat()
        .map(b => b.text);
      expect(labels.some(l => l.includes('Check again'))).toBe(false);
      expect(labels.some(l => l.includes('Snooze'))).toBe(true);
    });

    it('gives recovery no buttons - there is nothing to act on', async () => {
      expect(await buttonsFor('recovery')).toBeUndefined();
    });
  });
});
