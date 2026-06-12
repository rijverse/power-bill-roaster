export interface ReadingPoint {
  balance: number;
  at: Date;
}

export interface RunOutPrediction {
  /** BDT consumed per day, averaged over the observed window */
  burnPerDay: number;
  /** days until the balance hits zero at the current burn rate */
  daysLeft: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Below this observation span the burn rate is mostly noise
const MIN_SPAN_MS = 12 * 60 * 60 * 1000;
// Ignore sub-taka jitter between consecutive readings
const MIN_DROP = 0.01;

/**
 * Estimates when the balance hits zero from recent readings.
 *
 * Burn rate is computed from consecutive *declines* only - recharges
 * (balance increases) break the timeline and are skipped, so topping up
 * doesn't dilute the consumption estimate. Returns null when there isn't
 * enough declining data to say anything honest.
 */
export function predictRunOut(
  readings: ReadingPoint[],
  currentBalance: number
): RunOutPrediction | null {
  if (readings.length < 2) {
    return null;
  }

  const sorted = [...readings].sort((a, b) => a.at.getTime() - b.at.getTime());

  let totalDrop = 0;
  let totalMs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const drop = sorted[i - 1].balance - sorted[i].balance;
    const dt = sorted[i].at.getTime() - sorted[i - 1].at.getTime();
    if (drop >= MIN_DROP && dt > 0) {
      totalDrop += drop;
      totalMs += dt;
    }
  }

  if (totalMs < MIN_SPAN_MS || totalDrop <= 0) {
    return null;
  }

  const burnPerDay = totalDrop / (totalMs / DAY_MS);
  return {
    burnPerDay,
    daysLeft: Math.max(0, currentBalance) / burnPerDay,
  };
}

/** "less than a day" / "~2.5 days" - shared phrasing for alerts and /balance */
export function formatDaysLeft(daysLeft: number): string {
  if (daysLeft < 1) {
    return 'less than a day';
  }
  const rounded = Math.round(daysLeft * 2) / 2;
  return `~${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} days`;
}
