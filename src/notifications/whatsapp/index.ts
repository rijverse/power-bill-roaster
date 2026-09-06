import { ServerConfig } from '../../config';
import { WhatsAppSender } from './types';
import { ConsoleWhatsAppSender } from './console';

/**
 * Returns null when WhatsApp isn't configured - the dispatcher then skips the
 * channel entirely. When it is configured we hand back the console stub for now;
 * the real Cloud API sender replaces this line once credentials exist, and
 * nothing else has to change.
 */
export function createWhatsAppSender(config: ServerConfig): WhatsAppSender | null {
  if (!config.whatsapp) {
    return null;
  }
  return new ConsoleWhatsAppSender();
}

export * from './types';
export { ConsoleWhatsAppSender } from './console';
