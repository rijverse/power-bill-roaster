import { Dispatcher, TelegramSender } from '../../notifications/dispatcher';
import { WhatsAppSender } from '../../notifications/whatsapp';
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

// telegramChatId null so the Telegram branch is skipped; we're testing WhatsApp.
const user = { id: 1, telegramChatId: null, plan: 'free' } as unknown as schema.User;
const meter = { id: 7 } as unknown as schema.Meter;
const telegram: TelegramSender = { sendTelegram: jest.fn(async () => undefined) };
const waChannel = channel({ id: 9, type: 'whatsapp', address: '8801700000000' });

describe('Dispatcher whatsapp branch', () => {
  it('sends to a verified, enabled whatsapp channel on a low alert', async () => {
    const send = jest.fn(async (_phone: string, _text: string) => undefined);
    const whatsapp: WhatsAppSender = { name: 'test', send };
    const dispatcher = new Dispatcher(
      fakeChannelsDb([waChannel]),
      telegram,
      null,
      null,
      null,
      whatsapp
    );

    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('8801700000000');
    expect(result).toEqual({ delivered: ['whatsapp:9'], failed: [] });
  });

  it('reports the channel failed when the send throws', async () => {
    const whatsapp: WhatsAppSender = {
      name: 'test',
      send: jest.fn(async () => {
        throw new Error('cloud api 500');
      }),
    };
    const dispatcher = new Dispatcher(
      fakeChannelsDb([waChannel]),
      telegram,
      null,
      null,
      null,
      whatsapp
    );

    const result = await dispatcher.dispatchAlert(user, meter, 'critical-alert', 'critical', ctx);

    expect(result).toEqual({ delivered: [], failed: ['whatsapp:9'] });
  });

  it('is silent when no whatsapp sender is configured', async () => {
    const dispatcher = new Dispatcher(
      fakeChannelsDb([waChannel]),
      telegram,
      null,
      null,
      null,
      null
    );
    const result = await dispatcher.dispatchAlert(user, meter, 'low-alert', 'low', ctx);
    expect(result).toEqual({ delivered: [], failed: [] });
  });
});
