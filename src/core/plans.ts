/** Per-plan limits. Plus/business exist in the data model but aren't sellable yet. */
const PLAN_LIMITS: Record<string, { maxMeters: number }> = {
  free: { maxMeters: 1 },
  plus: { maxMeters: 5 },
  business: { maxMeters: Number.POSITIVE_INFINITY },
};

export function maxMetersFor(plan: string): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).maxMeters;
}
