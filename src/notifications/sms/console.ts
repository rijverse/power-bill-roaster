import { SmsGateway } from './types';
import { logger, maskPhone } from '../../logger';

/** Dev/mock gateway: prints instead of sending. */
export class ConsoleSmsGateway implements SmsGateway {
  readonly name = 'console';

  send(phone: string, text: string): Promise<void> {
    logger.info(`[sms:console] to ${maskPhone(phone)}: ${text}`);
    return Promise.resolve();
  }
}
