import { SmsGateway } from './types';

/** Dev/mock gateway: prints instead of sending. */
export class ConsoleSmsGateway implements SmsGateway {
  readonly name = 'console';

  send(phone: string, text: string): Promise<void> {
    console.log(`[sms:console] to ${phone}: ${text}`);
    return Promise.resolve();
  }
}
