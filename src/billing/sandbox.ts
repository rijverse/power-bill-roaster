import { CheckoutSession, PaymentProvider, PaymentStatus } from './types';

/** Auto-approving fake provider for dev and pre-launch testing. */
export class SandboxProvider implements PaymentProvider {
  readonly name = 'sandbox';

  createCheckout(opts: {
    userId: number;
    plan: string;
    amountBdt: number;
    reference: string;
  }): Promise<CheckoutSession> {
    return Promise.resolve({
      externalRef: `sandbox-${opts.reference}`,
      paymentUrl: null, // nothing to pay - verifyPayment will say paid
    });
  }

  verifyPayment(): Promise<PaymentStatus> {
    return Promise.resolve('paid');
  }
}
