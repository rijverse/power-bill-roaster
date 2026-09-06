/**
 * Is money actually being taken? The free-only launch runs with
 * BILLING_PROVIDER=none, and every surface that offers an upgrade has to agree
 * on that - it was being recomputed independently in both bots and three times
 * in the web layer.
 */
export function billingLive(billing: { provider: string }): boolean {
  return billing.provider !== 'none';
}

/** Per-plan limits and pricing. Plus/business become sellable when billing ships. */
const PLAN_LIMITS: Record<string, { maxMeters: number; smsPerMonth: number; priceBdt: number }> = {
  free: { maxMeters: 1, smsPerMonth: 0, priceBdt: 0 },
  plus: { maxMeters: 5, smsPerMonth: 30, priceBdt: 40 },
  business: { maxMeters: Number.POSITIVE_INFINITY, smsPerMonth: 100, priceBdt: 250 },
};

/** Plans a user can buy (everything except free). */
export const PURCHASABLE_PLANS = Object.keys(PLAN_LIMITS).filter(p => p !== 'free');

export function isPurchasablePlan(plan: string): boolean {
  return PURCHASABLE_PLANS.includes(plan);
}

export function maxMetersFor(plan: string): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).maxMeters;
}

/**
 * The account's real meter cap. An operator override (users.meter_limit, set from
 * the admin panel) wins over the plan default in both directions: a comped
 * account can watch more without inventing a plan, and one that is abusing the
 * free tier can be pinned lower. Null falls back to the plan.
 */
export function effectiveMeterLimit(user: { plan: string; meterLimit: number | null }): number {
  return user.meterLimit ?? maxMetersFor(user.plan);
}

/** Monthly SMS budget - the hard cap that keeps gateway costs bounded per user. */
export function smsPerMonthFor(plan: string): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).smsPerMonth;
}

/** Monthly price in BDT. */
export function priceBdtFor(plan: string): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).priceBdt;
}
