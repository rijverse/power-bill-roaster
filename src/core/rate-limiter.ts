/**
 * Sliding-window rate limiter, in-memory (fine for a single process).
 * Protects the DESCO API from being sprayed through our bot: registration
 * attempts and on-demand balance checks both count against it.
 */
export class RateLimiter {
  private attempts = new Map<string | number, number[]>();
  // last time we pruned fully-aged-out keys; null until the first call so the
  // sweep clock tracks the caller's time base (tests pass explicit `now`).
  private lastSweepAt: number | null = null;

  constructor(
    private maxAttempts: number,
    private windowMs: number
  ) {}

  /** Returns true and records the attempt, or false if the key is over its limit. */
  allow(key: string | number, now = Date.now()): boolean {
    this.sweep(now);
    const recent = (this.attempts.get(key) ?? []).filter(t => now - t < this.windowMs);
    if (recent.length >= this.maxAttempts) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return true;
  }

  /** Number of keys currently tracked. For tests/observability. */
  size(): number {
    return this.attempts.size;
  }

  // Without this, every distinct key (chat id, IP) that ever hit the limiter
  // would live in the map forever - a slow leak in a long-running process.
  // At most once per window, drop keys whose newest attempt has aged out.
  private sweep(now: number): void {
    if (this.lastSweepAt === null) {
      this.lastSweepAt = now;
      return;
    }
    if (now - this.lastSweepAt < this.windowMs) {
      return;
    }
    this.lastSweepAt = now;
    for (const [key, times] of this.attempts) {
      if (times.length === 0 || times[times.length - 1] < now - this.windowMs) {
        this.attempts.delete(key);
      }
    }
  }
}
