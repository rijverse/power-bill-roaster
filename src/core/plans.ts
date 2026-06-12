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

/** Monthly SMS budget - the hard cap that keeps gateway costs bounded per user. */
export function smsPerMonthFor(plan: string): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).smsPerMonth;
}

/** Monthly price in BDT. */
export function priceBdtFor(plan: string): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).priceBdt;
}
