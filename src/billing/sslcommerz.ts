import { CheckoutSession, PaymentProvider, PaymentStatus } from './types';

export interface SslcommerzConfig {
  storeId: string;
  storePassword: string;
  baseUrl: string; // sandbox: https://sandbox.sslcommerz.com
}

/**
 * SSLCommerz skeleton. The real flow once the store account exists:
 *   1. POST /gwprocess/v4/api.php       (store creds, amount, tran_id -> GatewayPageURL)
 *   2. user pays at GatewayPageURL; IPN hits our server
 *   3. GET /validator/api/validationserverAPI.php (val_id -> status VALID/VALIDATED)
 * Docs: https://developer.sslcommerz.com
 */
export class SslcommerzProvider implements PaymentProvider {
  readonly name = 'sslcommerz';

  constructor(private config: SslcommerzConfig) {}

  createCheckout(): Promise<CheckoutSession> {
    return Promise.reject(
      new Error('SSLCommerz provider is scaffolded but not implemented - store approval pending')
    );
  }

  verifyPayment(): Promise<PaymentStatus> {
    return Promise.reject(
      new Error('SSLCommerz provider is scaffolded but not implemented - store approval pending')
    );
  }
}
