/**
 * Is the poll loop stale? Two cycles' worth of silence means the scheduler is
 * wedged, not merely slow. Before the first cycle completes there's nothing to
 * compare against, so allow one full interval of grace from process start.
 *
 * Shared by /health (so an uptime monitor sees it) and by the in-process
 * watchdog (so a wedged process exits even when nobody is watching).
 */
export function pollIsStale(
  lastCycleCompletedAt: Date | null,
  startedAt: number,
  intervalMs: number,
  now: number = Date.now()
): boolean {
  return lastCycleCompletedAt
    ? now - lastCycleCompletedAt.getTime() > intervalMs * 2
    : now - startedAt > intervalMs;
}
