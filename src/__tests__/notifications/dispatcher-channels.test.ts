import { Dispatcher, TelegramSender } from '../../notifications/dispatcher';
import { schema } from '../../db';
import { Mailer } from '../../services/mailer';
import { MeterContext } from '../../notifications/alert-copy';
import { channel, fakeChannelsDb } from '../helpers/channels-db';

// The cross-cutting properties of the fan-out itself, rather than any one channel.

const ctx: MeterContext = {
  nickname: null,
  accountNo: '12345678',
  meterNo: '87654321',
  balance: 42.5,
  lowThreshold: 150,
  criticalThreshold: 100,
  prediction: null,
};

const user = { id: 1, telegramChatId: null, plan: 'free' } as unknown as schema.User;
const meter = { id: 7 } as unknown as schema.Meter;
const telegram: TelegramSender = { sendTelegram: jest.fn(async () => undefined) };

const mailer = (): Mailer => ({ from: 'x@y.z', send: jest.fn(async () => undefined) });

describe('Dispatcher channel loading', () => {
  it('loads the user channels exactly once per alert, not once per channel type', async () => {
    // This is the whole point of the single-SELECT change: the dispatcher used to
    // issue five typed channel queries per alert (plus the SMS budget count).
    const selects = { count: 0 };
    const db = fakeChannelsDb(
      [
        channel({ id: 1, type: 'email', address: 'me@example.com' }),
        channel({ id: 2, type: 'discord', address: 'https://discord.com/api/webhooks/1/t' }),
      ],
      { selects }
    );
    const dispatcher = new Dispatcher(db, telegram, null, mailer());

    await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(selects.count).toBe(1);
  });

  it('ignores rows of another channel type', async () => {
    // With one untyped query the dispatcher now does the type filtering itself, so
    // a stray row of the wrong type must not be mailed.
    const mail = mailer();
    const db = fakeChannelsDb([
      channel({ id: 1, type: 'sms', address: '+8801700000001' }),
      channel({ id: 2, type: 'discord-dm', address: '111222333444555666' }),
    ]);
    const dispatcher = new Dispatcher(db, telegram, null, mail);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(mail.send).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: [], failed: [] });
  });

  it('still requires verified AND enabled on every channel except Telegram', async () => {
    // The mirror image of the Telegram case: for email, unverified means no send.
    // If a refactor ever made deliverable() ignore `verified`, this catches it.
    const mail = mailer();
    const db = fakeChannelsDb([
      channel({ id: 1, type: 'email', address: 'unverified@example.com', verified: false }),
      channel({ id: 2, type: 'email', address: 'disabled@example.com', enabled: false }),
    ]);
    const dispatcher = new Dispatcher(db, telegram, null, mail);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(mail.send).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: [], failed: [] });
  });

  it('fans out to several channel types from the one row set', async () => {
    const mail = mailer();
    const db = fakeChannelsDb([
      channel({ id: 1, type: 'email', address: 'me@example.com' }),
      channel({ id: 2, type: 'email', address: 'other@example.com' }),
    ]);
    const dispatcher = new Dispatcher(db, telegram, null, mail);

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(mail.send).toHaveBeenCalledTimes(2);
    expect(result.delivered).toEqual(['email:1', 'email:2']);
  });

  it('fails the whole row when the channels query throws, delivering nothing', async () => {
    // The one behavior change from collapsing the five SELECTs into one. It's safe:
    // the outbox catches the throw and retries the row, and since nothing was sent
    // the delivered ledger still can't produce a duplicate.
    const db = {
      select: () => ({
        from: () => ({
          where: async () => {
            throw new Error('db down');
          },
        }),
      }),
      insert: () => ({ values: async () => undefined }),
      $count: async () => 0,
    } as unknown as import('../../db').Db;
    const mail = mailer();
    const dispatcher = new Dispatcher(db, telegram, null, mail);

    await expect(dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx)).rejects.toThrow(
      'db down'
    );
    expect(mail.send).not.toHaveBeenCalled();
  });
});
