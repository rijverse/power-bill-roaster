import { WhatsAppSender } from './types';
import { logger, maskPhone } from '../../logger';

/**
 * Stub sender: logs instead of calling a provider. Stands in until the real Meta
 * Cloud API sender is wired, so the channel, dispatcher fan-out, and connect flow
 * can all be exercised end to end in dev.
 */
export class ConsoleWhatsAppSender implements WhatsAppSender {
  readonly name = 'console';

  send(phone: string, text: string): Promise<void> {
    logger.info(`[whatsapp:console] to ${maskPhone(phone)}: ${text}`);
    return Promise.resolve();
  }
}
