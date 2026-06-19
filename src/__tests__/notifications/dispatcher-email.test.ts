import { Dispatcher, TelegramSender } from '../../notifications/dispatcher';
import { Db, schema } from '../../db';
import { Mailer } from '../../services/mailer';
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

// telegramChatId null so the Telegram branch is skipped; we're testing email.
const user = { id: 1, telegramChatId: null, plan: 'free' } as unknown as schema.User;
const meter = { id: 7 } as unknown as schema.Meter;

function fakeDb(emailChannels: unknown[]) {
  return {
    select: () => ({ from: () => ({ where: async () => emailChannels }) }),
    insert: () => ({ values: async () => undefined }),
  } as unknown as Db;
}

const telegram: TelegramSender = { sendTelegram: jest.fn(async () => undefined) };

describe('Dispatcher email branch', () => {
  it('emails a verified, enabled email channel on a low alert', async () => {
    const mailer: Mailer = { from: 'x@y.z', send: jest.fn(async () => undefined) };
    const db = fakeDb([
      { id: 9, address: 'me@example.com', type: 'email', verified: true, enabled: true },
    ]);
    const dispatcher = new Dispatcher(db, telegram, null, mailer);

    await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(mailer.send).toHaveBeenCalledTimes(1);
    const [to, subject] = (mailer.send as jest.Mock).mock.calls[0];
    expect(to).toBe('me@example.com');
    expect(subject).toContain('Ghost');
  });

  it('does nothing when no mailer is configured', async () => {
    const db = fakeDb([{ id: 9, address: 'me@example.com', verified: true, enabled: true }]);
    const dispatcher = new Dispatcher(db, telegram, null, null);
    await expect(
      dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx)
    ).resolves.toBeUndefined();
  });
});
