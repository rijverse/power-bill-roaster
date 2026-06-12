import { periodEnd } from '../../billing/subscriptions';
import { SandboxProvider } from '../../billing/sandbox';
import { isPurchasablePlan, priceBdtFor, PURCHASABLE_PLANS } from '../../core/plans';

describe('periodEnd', () => {
  it('adds 30 days by default', () => {
    const start = new Date('2026-06-12T00:00:00Z');
    expect(periodEnd(start)).toEqual(new Date('2026-07-12T00:00:00Z'));
  });

  it('honors a custom day count', () => {
    const start = new Date('2026-06-12T00:00:00Z');
    expect(periodEnd(start, 7)).toEqual(new Date('2026-06-19T00:00:00Z'));
  });
});

describe('SandboxProvider', () => {
  it('auto-approves checkouts', async () => {
    const provider = new SandboxProvider();
    const checkout = await provider.createCheckout({
      userId: 1,
      plan: 'plus',
      amountBdt: 40,
      reference: 'test-ref',
    });
    expect(checkout.externalRef).toBe('sandbox-test-ref');
    expect(checkout.paymentUrl).toBeNull();
    await expect(provider.verifyPayment()).resolves.toBe('paid');
  });
});

describe('plan purchasability and pricing', () => {
  it('free is not purchasable; plus and business are', () => {
    expect(isPurchasablePlan('free')).toBe(false);
    expect(isPurchasablePlan('plus')).toBe(true);
    expect(isPurchasablePlan('business')).toBe(true);
    expect(isPurchasablePlan('nonsense')).toBe(false);
    expect(PURCHASABLE_PLANS).toEqual(['plus', 'business']);
  });

  it('every purchasable plan has a positive price', () => {
    for (const plan of PURCHASABLE_PLANS) {
      expect(priceBdtFor(plan)).toBeGreaterThan(0);
    }
    expect(priceBdtFor('free')).toBe(0);
  });
});
