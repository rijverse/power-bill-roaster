import { RateLimiter } from '../../core/rate-limiter';
import { maxMetersFor } from '../../core/plans';

describe('RateLimiter', () => {
  const WINDOW = 10 * 60 * 1000;
  const t0 = 1_000_000;

  it('allows attempts up to the limit', () => {
    const limiter = new RateLimiter(3, WINDOW);
    expect(limiter.allow('a', t0)).toBe(true);
    expect(limiter.allow('a', t0 + 1)).toBe(true);
    expect(limiter.allow('a', t0 + 2)).toBe(true);
  });

  it('blocks once the limit is reached within the window', () => {
    const limiter = new RateLimiter(3, WINDOW);
    limiter.allow('a', t0);
    limiter.allow('a', t0 + 1);
    limiter.allow('a', t0 + 2);
    expect(limiter.allow('a', t0 + 3)).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = new RateLimiter(1, WINDOW);
    expect(limiter.allow('a', t0)).toBe(true);
    expect(limiter.allow('b', t0)).toBe(true);
    expect(limiter.allow('a', t0 + 1)).toBe(false);
  });

  it('frees capacity once attempts age out of the window', () => {
    const limiter = new RateLimiter(2, WINDOW);
    limiter.allow('a', t0);
    limiter.allow('a', t0 + 1);
    expect(limiter.allow('a', t0 + 2)).toBe(false);
    expect(limiter.allow('a', t0 + WINDOW + 2)).toBe(true);
  });

  it('blocked attempts do not extend the window', () => {
    const limiter = new RateLimiter(1, WINDOW);
    limiter.allow('a', t0);
    limiter.allow('a', t0 + 1); // blocked, must not count
    expect(limiter.allow('a', t0 + WINDOW)).toBe(true);
  });
});

describe('maxMetersFor', () => {
  it('caps free at 1 and plus at 5', () => {
    expect(maxMetersFor('free')).toBe(1);
    expect(maxMetersFor('plus')).toBe(5);
  });

  it('falls back to the free limit for unknown plans', () => {
    expect(maxMetersFor('enterprise-typo')).toBe(1);
  });
});
