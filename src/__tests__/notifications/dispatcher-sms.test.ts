import { Dispatcher, TelegramSender } from '../../notifications/dispatcher';
import { SmsGateway } from '../../notifications/sms';
import { schema } from '../../db';
import { smsPerMonthFor } from '../../core/plans';
import { MeterContext } from '../../notifications/alert-copy';
import { channel, fakeChannelsDb } from '../helpers/channels-db';

// Read the real cap rather than hard-coding it, so a plan change can't quietly
// invalidate the budget assertions below.
const PLUS_BUDGET = smsPerMonthFor('plus');

// The SMS branch had no test either, and it is the one channel that costs real
// money per send. The monthly budget is the hard cap on billable segments; a
// shared fan-out helper that lost the decrement would let a user with several
// verified numbers overshoot it in a single alert.

const ctx: MeterContext = {
  nickname: null,
  accountNo: '12345678',
  meterNo: '87654321',
  balance: 42.5,
  lowThreshold: 150,
  criticalThreshold: 100,
  prediction: null,
};

// telegramChatId null so the Telegram branch bails; 'plus' has a nonzero SMS budget.
const user = { id: 1, telegramChatId: null, plan: 'plus' } as unknown as schema.User;
const meter = { id: 7 } as unknown as schema.Meter;

const telegram: TelegramSender = { sendTelegram: jest.fn(async () => undefined) };

function gateway(): SmsGateway {
  return { name: 'fake', send: jest.fn(async () => undefined) };
}

const phone = (id: number, address = `+88017000000${id}`) =>
  channel({ id, type: 'sms', address });

describe('Dispatcher SMS branch', () => {
  it('texts a verified, enabled number on a low alert', async () => {
    const sms = gateway();
    const db = fakeChannelsDb([phone(9)]);
    const dispatcher = new Dispatcher(db, telegram, sms);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(sms.send).toHaveBeenCalledTimes(1);
    const [to, text] = (sms.send as jest.Mock).mock.calls[0];
    expect(to).toBe('+880170000009');
    expect(text).toContain('LOW');
    expect(result).toEqual({ delivered: ['sms:9'], failed: [] });
  });

  it('never texts for reminders or recovery - not worth a paid segment', async () => {
    for (const action of ['reminder', 'recovery'] as const) {
      const sms = gateway();
      const dispatcher = new Dispatcher(fakeChannelsDb([phone(9)]), telegram, sms);
      await dispatcher.dispatchAlert(user, meter, action, 'low', ctx);
      expect(sms.send).not.toHaveBeenCalled();
    }
  });

  it('sends nothing on a plan with no SMS budget', async () => {
    const sms = gateway();
    const free = { ...user, plan: 'free' };
    const dispatcher = new Dispatcher(fakeChannelsDb([phone(9)]), telegram, sms);

    await dispatcher.dispatchAlert(free, meter, 'low-alert', 'low', ctx);

    expect(sms.send).not.toHaveBeenCalled();
  });

  it('skips unverified and disabled numbers', async () => {
    const sms = gateway();
    const db = fakeChannelsDb([
      channel({ id: 1, type: 'sms', verified: false }),
      channel({ id: 2, type: 'sms', enabled: false }),
    ]);
    const dispatcher = new Dispatcher(db, telegram, sms);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(sms.send).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: [], failed: [] });
  });

  it('sends nothing once the monthly budget is already spent', async () => {
    const sms = gateway();
    const db = fakeChannelsDb([phone(9)], { smsUsedThisMonth: 50 });
    const dispatcher = new Dispatcher(db, telegram, sms);

    const result = await dispatcher.dispatchAlert(user, meter, 'critical-alert', 'critical', ctx);

    expect(sms.send).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: [], failed: [] });
  });

  it('stops mid-fan-out rather than overshooting the budget with several numbers', async () => {
    // Two verified numbers, one segment of budget left. Exactly one may go out -
    // this is the assertion a naive shared fan-out helper would break.
    const sms = gateway();
    const db = fakeChannelsDb([phone(1), phone(2), phone(3)], {
      smsUsedThisMonth: PLUS_BUDGET - 1,
    });
    const dispatcher = new Dispatcher(db, telegram, sms);

    const result = await dispatcher.dispatchAlert(user, meter, 'critical-alert', 'critical', ctx);

    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(result.delivered).toEqual(['sms:1']);
    expect(result.failed).toEqual([]);
  });

  it('does not let an already-delivered key consume budget', async () => {
    // sms:1's 'sent' row is already counted in usedThisMonth, so skipping it must
    // not also decrement - otherwise a retry would silently cost a segment.
    const sms = gateway();
    const db = fakeChannelsDb([phone(1), phone(2)], { smsUsedThisMonth: PLUS_BUDGET - 1 });
    const dispatcher = new Dispatcher(db, telegram, sms);

    const result = await dispatcher.dispatchAlert(
      user,
      meter,
      'critical-alert',
      'critical',
      ctx,
      new Set(['sms:1'])
    );

    expect(sms.send).toHaveBeenCalledTimes(1);
    expect((sms.send as jest.Mock).mock.calls[0][0]).toBe('+880170000002');
    expect(result.delivered).toEqual(['sms:2']);
  });

  it('does not burn budget on a failed send', async () => {
    // The failure isn't counted in usedThisMonth (it logs 'failed'), so the next
    // number must still get its segment.
    const sms: SmsGateway = {
      name: 'fake',
      send: jest
        .fn()
        .mockRejectedValueOnce(new Error('carrier down'))
        .mockResolvedValueOnce(undefined),
    };
    const db = fakeChannelsDb([phone(1), phone(2)], { smsUsedThisMonth: PLUS_BUDGET - 1 });
    const dispatcher = new Dispatcher(db, telegram, sms);

    const result = await dispatcher.dispatchAlert(user, meter, 'critical-alert', 'critical', ctx);

    expect(sms.send).toHaveBeenCalledTimes(2);
    expect(result.failed).toEqual(['sms:1']);
    expect(result.delivered).toEqual(['sms:2']);
  });

  it('logs a delivery row per send', async () => {
    const log: Record<string, unknown>[] = [];
    const sms = gateway();
    const db = fakeChannelsDb([phone(9)], { log });
    const dispatcher = new Dispatcher(db, telegram, sms);

    await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(log).toContainEqual(
      expect.objectContaining({ meterId: 7, channelId: 9, deliveryStatus: 'sent' })
    );
  });

  it('does nothing when no SMS gateway is configured', async () => {
    const dispatcher = new Dispatcher(fakeChannelsDb([phone(9)]), telegram, null);
    await expect(
      dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx)
    ).resolves.toEqual({ delivered: [], failed: [] });
  });
});
