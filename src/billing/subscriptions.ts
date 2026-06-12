import { eq, and, lt } from 'drizzle-orm';
import { Db, schema } from '../db';
import { priceBdtFor } from '../core/plans';
import { PaymentProvider } from './types';

const PERIOD_DAYS = 30;
// Don't downgrade the moment a period lapses - give renewal a few days
const GRACE_DAYS = 3;

export function periodEnd(start: Date, days = PERIOD_DAYS): Date {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

export class SubscriptionService {
  constructor(
    private db: Db,
    private provider: PaymentProvider
  ) {}

  /**
   * Starts an upgrade. With the sandbox/manual providers this activates
   * immediately; with real providers the user gets a payment URL and
   * activation happens after verifyPayment confirms.
   */
  async startUpgrade(
    user: schema.User,
    plan: string
  ): Promise<{ activated: boolean; paymentUrl: string | null }> {
    const reference = `u${user.id}-${plan}-${Date.now()}`;
    const checkout = await this.provider.createCheckout({
      userId: user.id,
      plan,
      amountBdt: priceBdtFor(plan),
      reference,
    });

    const [subscription] = await this.db
      .insert(schema.subscriptions)
      .values({
        userId: user.id,
        plan,
        provider: this.provider.name,
        status: 'pending',
        externalRef: checkout.externalRef,
      })
      .returning();

    const status = await this.provider.verifyPayment(checkout.externalRef);
    if (status === 'paid') {
      await this.activate(subscription.id);
      return { activated: true, paymentUrl: null };
    }
    return { activated: false, paymentUrl: checkout.paymentUrl };
  }

  /** Marks a subscription active for one period and applies the plan to the user. */
  async activate(subscriptionId: number, days = PERIOD_DAYS): Promise<void> {
    const now = new Date();
    const [subscription] = await this.db
      .update(schema.subscriptions)
      .set({
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd(now, days),
        updatedAt: now,
      })
      .where(eq(schema.subscriptions.id, subscriptionId))
      .returning();
    await this.db
      .update(schema.users)
      .set({ plan: subscription.plan })
      .where(eq(schema.users.id, subscription.userId));
  }

  /** Admin path: grant a plan without payment (early supporters, beta testers). */
  async grant(userId: number, plan: string, days = PERIOD_DAYS): Promise<void> {
    const [subscription] = await this.db
      .insert(schema.subscriptions)
      .values({ userId, plan, provider: 'manual', status: 'pending' })
      .returning();
    await this.activate(subscription.id, days);
  }

  /** Downgrades users whose subscription lapsed past the grace period. Idempotent. */
  async expireOverdue(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - GRACE_DAYS * 24 * 60 * 60 * 1000);
    const overdue = await this.db
      .select()
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.status, 'active'),
          lt(schema.subscriptions.currentPeriodEnd, cutoff)
        )
      );

    for (const subscription of overdue) {
      await this.db
        .update(schema.subscriptions)
        .set({ status: 'expired', updatedAt: now })
        .where(eq(schema.subscriptions.id, subscription.id));
      await this.db
        .update(schema.users)
        .set({ plan: 'free' })
        .where(eq(schema.users.id, subscription.userId));
      console.log(`Subscription ${subscription.id} expired; user ${subscription.userId} -> free`);
    }
    return overdue.length;
  }

  /** The user's current active subscription, if any. */
  async activeFor(userId: number): Promise<schema.Subscription | null> {
    const [subscription] = await this.db
      .select()
      .from(schema.subscriptions)
      .where(
        and(eq(schema.subscriptions.userId, userId), eq(schema.subscriptions.status, 'active'))
      );
    return subscription ?? null;
  }
}
