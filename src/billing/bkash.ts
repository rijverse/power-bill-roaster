import { CheckoutSession, PaymentProvider, PaymentStatus } from './types';

export interface BkashConfig {
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
  baseUrl: string; // sandbox: https://tokenized.sandbox.bka.sh/v1.2.0-beta
}

/**
 * bKash Tokenized Checkout skeleton. The real flow once merchant credentials
 * exist:
 *   1. POST /tokenized/checkout/token/grant   (appKey+secret -> id_token)
 *   2. POST /tokenized/checkout/create        (amount, merchantInvoiceNumber -> paymentID, bkashURL)
 *   3. user pays at bkashURL; callback hits our server
 *   4. POST /tokenized/checkout/execute       (paymentID -> transactionStatus)
 * Docs: https://developer.bka.sh
 */
export class BkashProvider implements PaymentProvider {
  readonly name = 'bkash';

  constructor(private config: BkashConfig) {}

  createCheckout(): Promise<CheckoutSession> {
    return Promise.reject(
      new Error('bKash provider is scaffolded but not implemented - merchant approval pending')
    );
  }

  verifyPayment(): Promise<PaymentStatus> {
    return Promise.reject(
      new Error('bKash provider is scaffolded but not implemented - merchant approval pending')
    );
  }
}
