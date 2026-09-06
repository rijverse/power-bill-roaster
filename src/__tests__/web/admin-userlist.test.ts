import { staleCutoff } from '../../web/admin';

describe('staleCutoff', () => {
  const now = new Date('2026-07-02T12:00:00Z');

  it('is 2x the poll interval before now', () => {
    // 6h poll interval -> a meter is "stale" once its last reading is >12h old
    expect(staleCutoff(6, now).toISOString()).toBe('2026-07-02T00:00:00.000Z');
  });

  it('scales with the interval', () => {
    expect(staleCutoff(1, now).toISOString()).toBe('2026-07-02T10:00:00.000Z');
    expect(staleCutoff(12, now).toISOString()).toBe('2026-07-01T12:00:00.000Z');
  });
});
