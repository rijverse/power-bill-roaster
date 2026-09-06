import { ServerConfig } from '../config';
import { PaymentProvider } from './types';
import { NoopProvider } from './none';
import { SandboxProvider } from './sandbox';
import { BkashProvider } from './bkash';
import { SslcommerzProvider } from './sslcommerz';

export function createPaymentProvider(config: ServerConfig): PaymentProvider {
  switch (config.billing.provider) {
    case 'none':
      return new NoopProvider();
    case 'sandbox':
      return new SandboxProvider();
    case 'bkash':
      return new BkashProvider(config.billing.bkash);
    case 'sslcommerz':
      return new SslcommerzProvider(config.billing.sslcommerz);
  }
}

export * from './types';
export { SubscriptionService, periodEnd } from './subscriptions';
export { NoopProvider } from './none';
export { SandboxProvider } from './sandbox';
