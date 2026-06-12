export interface CheckoutSession {
  /** provider-side reference (payment id / session key) */
  externalRef: string;
  /** where to send the user to pay; null when no user action is needed (sandbox/manual) */
  paymentUrl: string | null;
}

export type PaymentStatus = 'paid' | 'pending' | 'failed';

/**
 * A payment provider adapter. Sandbox auto-approves (dev/testing); bKash and
 * SSLCommerz implement the same interface once merchant credentials exist.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(opts: {
    userId: number;
    plan: string;
    amountBdt: number;
    reference: string;
  }): Promise<CheckoutSession>;
  verifyPayment(externalRef: string): Promise<PaymentStatus>;
}
