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
