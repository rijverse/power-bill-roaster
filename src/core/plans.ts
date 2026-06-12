/** Per-plan limits. Plus/business exist in the data model but aren't sellable yet. */
const PLAN_LIMITS: Record<string, { maxMeters: number; smsPerMonth: number }> = {
  free: { maxMeters: 1, smsPerMonth: 0 },
  plus: { maxMeters: 5, smsPerMonth: 30 },
  business: { maxMeters: Number.POSITIVE_INFINITY, smsPerMonth: 100 },
};

export function maxMetersFor(plan: string): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).maxMeters;
}

/** Monthly SMS budget - the hard cap that keeps gateway costs bounded per user. */
export function smsPerMonthFor(plan: string): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).smsPerMonth;
}
