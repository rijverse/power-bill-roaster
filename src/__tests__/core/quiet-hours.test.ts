import { dhakaHour, inQuietHours, quietHoursEnd } from '../../core/quiet-hours';

// Asia/Dhaka is a fixed UTC+6 (no DST), so these instants map to stable hours.
const at = (iso: string) => new Date(iso);

describe('dhakaHour', () => {
  it('resolves UTC instants to Dhaka wall-clock hours (UTC+6)', () => {
    expect(dhakaHour(at('2026-06-23T00:00:00Z'))).toBe(6); // 06:00 Dhaka
    expect(dhakaHour(at('2026-06-22T19:00:00Z'))).toBe(1); // 01:00 next day
    expect(dhakaHour(at('2026-06-23T06:00:00Z'))).toBe(12); // noon
  });
});

describe('inQuietHours', () => {
  it('is off when unset or empty window', () => {
    expect(inQuietHours(at('2026-06-23T00:00:00Z'), null, null)).toBe(false);
    expect(inQuietHours(at('2026-06-23T00:00:00Z'), 5, 5)).toBe(false);
  });

  it('handles a normal daytime window', () => {
    const at6 = at('2026-06-23T00:00:00Z'); // 06:00 Dhaka
    expect(inQuietHours(at6, 5, 8)).toBe(true); // 6 in [5,8)
    expect(inQuietHours(at6, 8, 10)).toBe(false);
    expect(inQuietHours(at6, 6, 9)).toBe(true); // inclusive start
    expect(inQuietHours(at6, 4, 6)).toBe(false); // exclusive end
  });

  it('wraps past midnight (e.g. 23:00 -> 07:00)', () => {
    expect(inQuietHours(at('2026-06-22T19:00:00Z'), 23, 7)).toBe(true); // 01:00 Dhaka
    expect(inQuietHours(at('2026-06-22T17:30:00Z'), 23, 7)).toBe(true); // 23:30 Dhaka
    expect(inQuietHours(at('2026-06-23T06:00:00Z'), 23, 7)).toBe(false); // 12:00 Dhaka
  });
});

describe('quietHoursEnd', () => {
  // the outbox worker uses this to DEFER a held alert to the end of the
  // window - it must always land on the next `end`:00 Dhaka wall-clock time
  it('resolves to later the same Dhaka day when the end is still ahead', () => {
    // 01:00 Dhaka, window ends 07:00 -> 07:00 Dhaka = 01:00 UTC same day
    expect(quietHoursEnd(at('2026-06-22T19:00:00Z'), 7).toISOString()).toBe(
      '2026-06-23T01:00:00.000Z'
    );
  });

  it('rolls to tomorrow when the end already passed today', () => {
    // 12:00 Dhaka, window ends 07:00 -> tomorrow 07:00 Dhaka
    expect(quietHoursEnd(at('2026-06-23T06:00:00Z'), 7).toISOString()).toBe(
      '2026-06-24T01:00:00.000Z'
    );
  });

  it('is always in the future and within 24h', () => {
    const now = at('2026-06-23T00:00:00Z');
    for (let end = 0; end < 24; end++) {
      const t = quietHoursEnd(now, end).getTime();
      expect(t).toBeGreaterThan(now.getTime());
      expect(t).toBeLessThanOrEqual(now.getTime() + 24 * 60 * 60 * 1000);
    }
  });
});
