import { pollIsStale } from '../../core/health';

const HOUR = 60 * 60 * 1000;
const INTERVAL = 6 * HOUR;

describe('pollIsStale', () => {
  const now = Date.UTC(2026, 6, 11, 12, 0, 0);

  it('is fresh right after a cycle, and up to two intervals later', () => {
    expect(pollIsStale(new Date(now - 1000), 0, INTERVAL, now)).toBe(false);
    expect(pollIsStale(new Date(now - 2 * INTERVAL + 1000), 0, INTERVAL, now)).toBe(false);
  });

  it('is stale once two intervals have passed with no cycle', () => {
    expect(pollIsStale(new Date(now - 2 * INTERVAL - 1000), 0, INTERVAL, now)).toBe(true);
  });

  describe('before the first cycle ever completes', () => {
    it('allows one full interval of grace from process start', () => {
      // Boot is not a wedge: the first cycle has to be given time to land, or a
      // slow start would restart-loop the process.
      expect(pollIsStale(null, now - INTERVAL + 1000, INTERVAL, now)).toBe(false);
    });

    it('but reports stale once even that grace has passed', () => {
      expect(pollIsStale(null, now - INTERVAL - 1000, INTERVAL, now)).toBe(true);
    });
  });
});
