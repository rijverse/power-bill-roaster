import { CheckoutSession, PaymentProvider, PaymentStatus } from './types';

/**
 * "Paid plans are switched off" - the default (BILLING_PROVIDER=none). A
 * free-only launch wires this so /upgrade can't take money or hand out a plan.
 * The bot refuses /upgrade before reaching here; these methods throw only as a
 * safety net, so a missed guard fails loudly instead of granting a free upgrade.
 */
export class NoopProvider implements PaymentProvider {
  readonly name = 'none';
  readonly autoConfirms = false;

  createCheckout(): Promise<CheckoutSession> {
    throw new Error('Billing is disabled (BILLING_PROVIDER=none); no checkout can be created.');
  }

  verifyPayment(): Promise<PaymentStatus> {
    throw new Error('Billing is disabled (BILLING_PROVIDER=none); no payment can be verified.');
  }
}
