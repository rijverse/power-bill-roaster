import { eq, and, lt } from 'drizzle-orm';
import { Db, schema } from '../db';
import { priceBdtFor } from '../core/plans';
import { enforceMeterCap } from '../core/meter-cap';
import { PaymentProvider, PaymentStatus } from './types';

const PERIOD_DAYS = 30;
// Don't downgrade the moment a period lapses - give renewal a few days
const GRACE_DAYS = 3;

export function periodEnd(start: Date, days = PERIOD_DAYS): Date {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

export class SubscriptionService {
  /** wired in after the bot exists; tells the user their plan lapsed */
  notifyDowngrade:
    ((chatId: number, expiredPlan: string, pausedMeters: number) => Promise<void>) | null = null;

  /** wired in after the bot exists; tells the user a pending payment cleared */
  notifyUpgrade: ((chatId: number, plan: string) => Promise<void>) | null = null;

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

    // Sandbox clears instantly. Real providers send the user to paymentUrl and
    // confirm later through finalizePending (called from the payment callback) -
    // verifying here would just execute against an unauthorized payment.
    if (this.provider.autoConfirms) {
      const status = await this.provider.verifyPayment(checkout.externalRef);
      if (status === 'paid') {
        await this.recordPayment(subscription.id, user.id, checkout.externalRef, plan);
        await this.activate(subscription.id);
        return { activated: true, paymentUrl: null };
      }
    }
    return { activated: false, paymentUrl: checkout.paymentUrl };
  }

  /**
   * Confirms a pending payment after the provider's callback fires. Re-verifies
   * with the provider server-side (never trusting the callback's own claims) and
   * is idempotent - a duplicate callback or IPN won't double-charge or re-notify.
   */
  async finalizePending(
    externalRef: string
  ): Promise<{ status: PaymentStatus; activated: boolean }> {
    const [subscription] = await this.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.externalRef, externalRef));
    if (!subscription) {
      return { status: 'failed', activated: false };
    }
    if (subscription.status === 'active') {
      return { status: 'paid', activated: false }; // already finalized
    }

    const status = await this.provider.verifyPayment(externalRef);
    if (status !== 'paid') {
      return { status, activated: false };
    }

    const firstTime = await this.recordPayment(
      subscription.id,
      subscription.userId,
      externalRef,
      subscription.plan
    );
    await this.activate(subscription.id);

    // Only the callback that actually books the payment notifies, so a racing
    // redirect + IPN for the same payment can't double-message the user.
    if (firstTime && this.notifyUpgrade) {
      const [user] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, subscription.userId));
      if (user?.telegramChatId != null) {
        try {
          await this.notifyUpgrade(user.telegramChatId, subscription.plan);
        } catch (error) {
          console.error(`Upgrade notice failed for user ${subscription.userId}:`, error);
        }
      }
    }
    return { status: 'paid', activated: true };
  }

  /**
   * Append to the money ledger. The unique external_ref index makes this safe
   * under concurrent callbacks; returns true only when this call inserted the
   * row (false means another callback already booked it).
   */
  private async recordPayment(
    subscriptionId: number,
    userId: number,
    externalRef: string,
    plan: string
  ): Promise<boolean> {
    const inserted = await this.db
      .insert(schema.payments)
      .values({
        subscriptionId,
        userId,
        provider: this.provider.name,
        externalRef,
        amountBdt: priceBdtFor(plan),
      })
      .onConflictDoNothing({ target: schema.payments.externalRef })
      .returning();
    return inserted.length > 0;
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

      // enforce the free-plan meter cap, or downgraded users would keep
      // paid-tier service forever: keep the oldest meters, pause the rest
      const paused = await enforceMeterCap(this.db, subscription.userId, 'free');

      const [user] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, subscription.userId));
      if (this.notifyDowngrade && user?.telegramChatId != null) {
        try {
          await this.notifyDowngrade(user.telegramChatId, subscription.plan, paused);
        } catch (error) {
          console.error(`Downgrade notice failed for user ${subscription.userId}:`, error);
        }
      }
      console.log(
        `Subscription ${subscription.id} expired; user ${subscription.userId} -> free` +
          (paused > 0 ? `, paused ${paused} meter(s)` : '')
      );
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
