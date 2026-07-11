// Quiet hours are stored as local Asia/Dhaka hours (0-23). DESCO is a Bangladesh
// service, so the meter owner's wall clock is effectively Dhaka time (UTC+6, no
// DST). We resolve "now" to a Dhaka hour and check whether it falls in the
// user's quiet window, which may wrap past midnight (e.g. 23 -> 7).

/** Current hour-of-day (0-23) in Asia/Dhaka. */
export function dhakaHour(now: Date): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return Number(h) % 24;
}

/**
 * True when `now` is inside [start, end) in Dhaka time. Handles windows that
 * wrap past midnight. Both null (or equal) means quiet hours are off.
 */
export function inQuietHours(now: Date, start: number | null, end: number | null): boolean {
  if (start == null || end == null || start === end) {
    return false;
  }
  const h = dhakaHour(now);
  return start < end ? h >= start && h < end : h >= start || h < end;
}

// Bangladesh has no DST, so a fixed offset is exact (and cheaper than Intl).
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The next instant the quiet window ends: today at `end`:00 Dhaka time, or
 * tomorrow if that has already passed. Used to defer a held-back alert rather
 * than drop it.
 */
export function quietHoursEnd(now: Date, end: number): Date {
  const dhakaMs = now.getTime() + DHAKA_OFFSET_MS;
  const dhakaMidnight = Math.floor(dhakaMs / DAY_MS) * DAY_MS;
  let target = dhakaMidnight + end * 60 * 60 * 1000;
  if (target <= dhakaMs) {
    target += DAY_MS;
  }
  return new Date(target - DHAKA_OFFSET_MS);
}
