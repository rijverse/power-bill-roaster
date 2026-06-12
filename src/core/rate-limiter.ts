/**
 * Sliding-window rate limiter, in-memory (fine for a single process).
 * Protects the DESCO API from being sprayed through our bot: registration
 * attempts and on-demand balance checks both count against it.
 */
export class RateLimiter {
  private attempts = new Map<string | number, number[]>();

  constructor(
    private maxAttempts: number,
    private windowMs: number
  ) {}

  /** Returns true and records the attempt, or false if the key is over its limit. */
  allow(key: string | number, now = Date.now()): boolean {
    const recent = (this.attempts.get(key) ?? []).filter(t => now - t < this.windowMs);
    if (recent.length >= this.maxAttempts) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return true;
  }
}
