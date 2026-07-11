import { Dispatcher, SEND_TIMEOUT_MS, TelegramSender } from '../../notifications/dispatcher';
import { schema } from '../../db';
import { Mailer } from '../../services/mailer';
import { MeterContext } from '../../notifications/alert-copy';
import { channel, fakeChannelsDb } from '../helpers/channels-db';

// A channel that accepts the connection and then goes quiet used to block the
// outbox worker's entire batch - and because the worker skips a tick while one is
// in flight, that stalled *all* alert delivery until the transport gave up on its
// own, which for a raw socket may be never. Every send is bounded now.

const ctx: MeterContext = {
  nickname: null,
  accountNo: '12345678',
  meterNo: '87654321',
  balance: 42.5,
  lowThreshold: 150,
  criticalThreshold: 100,
  prediction: null,
};

const meter = { id: 7 } as unknown as schema.Meter;
const hangs = () => new Promise<never>(() => {});

describe('Dispatcher send timeouts', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('records a hung email as failed instead of waiting on it forever', async () => {
    const user = { id: 1, telegramChatId: null, plan: 'free' } as unknown as schema.User;
    const mailer: Mailer = { from: 'x@y.z', send: jest.fn(hangs) };
    const db = fakeChannelsDb([channel({ id: 9, type: 'email', address: 'me@example.com' })]);
    const telegram: TelegramSender = { sendTelegram: jest.fn(async () => undefined) };
    const dispatcher = new Dispatcher(db, telegram, null, mailer);

    const dispatch = dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);
    await jest.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1000);

    // The whole point: it resolves at all, and reports the channel failed so the
    // outbox retries it rather than hanging on it.
    await expect(dispatch).resolves.toEqual({ delivered: [], failed: ['email:9'] });
  });

  it('records a hung telegram send as failed', async () => {
    const user = { id: 1, telegramChatId: 555, plan: 'free' } as unknown as schema.User;
    const telegram: TelegramSender = { sendTelegram: jest.fn(hangs) };
    const dispatcher = new Dispatcher(fakeChannelsDb([]), telegram, null, null);

    const dispatch = dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);
    await jest.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1000);

    await expect(dispatch).resolves.toEqual({ delivered: [], failed: ['telegram'] });
  });

  it('lets a healthy channel through while another one hangs', async () => {
    // Channels fan out in parallel, so one dead transport must not take the rest
    // of the alert down with it.
    const user = { id: 1, telegramChatId: 555, plan: 'free' } as unknown as schema.User;
    const mailer: Mailer = { from: 'x@y.z', send: jest.fn(hangs) };
    const telegram: TelegramSender = { sendTelegram: jest.fn(async () => undefined) };
    const db = fakeChannelsDb([channel({ id: 9, type: 'email', address: 'me@example.com' })]);
    const dispatcher = new Dispatcher(db, telegram, null, mailer);

    const dispatch = dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);
    await jest.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1000);
    const result = await dispatch;

    expect(result.delivered).toEqual(['telegram']);
    expect(result.failed).toEqual(['email:9']);
  });

  it('does not time out a send that answers in time', async () => {
    const user = { id: 1, telegramChatId: null, plan: 'free' } as unknown as schema.User;
    const mailer: Mailer = {
      from: 'x@y.z',
      send: jest.fn(() => new Promise<void>(resolve => setTimeout(resolve, SEND_TIMEOUT_MS / 2))),
    };
    const db = fakeChannelsDb([channel({ id: 9, type: 'email', address: 'me@example.com' })]);
    const telegram: TelegramSender = { sendTelegram: jest.fn(async () => undefined) };
    const dispatcher = new Dispatcher(db, telegram, null, mailer);

    const dispatch = dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);
    await jest.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);

    await expect(dispatch).resolves.toEqual({ delivered: ['email:9'], failed: [] });
  });
});
