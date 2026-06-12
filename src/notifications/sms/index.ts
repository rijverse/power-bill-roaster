import { ServerConfig } from '../../config';
import { SmsGateway } from './types';
import { ConsoleSmsGateway } from './console';
import { BulkSmsBdGateway } from './bulksmsbd';

/** Returns null when SMS is not configured - the dispatcher skips the channel entirely. */
export function createSmsGateway(config: ServerConfig): SmsGateway | null {
  switch (config.sms.gateway) {
    case 'console':
      return new ConsoleSmsGateway();
    case 'bulksmsbd':
      return new BulkSmsBdGateway(config.sms.bulksmsbd);
    case null:
      return null;
  }
}

export * from './types';
export { ConsoleSmsGateway } from './console';
export { BulkSmsBdGateway } from './bulksmsbd';
