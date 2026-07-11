/**
 * Reject if `work` hasn't settled within `ms`.
 *
 * The outbox worker skips a tick while a batch is in flight, so anything it awaits
 * without a bound can stop alert delivery entirely: a hung channel send (an SMTP
 * socket that never closes, a webhook that accepts the connection and then goes
 * quiet) used to block the whole outbox until the transport gave up on its own -
 * for a raw socket, potentially never. Every send, and every row, is now bounded.
 *
 * Note this doesn't *cancel* the underlying work - it just stops waiting on it.
 * That's fine here: an abandoned send is recorded as failed and the row is retried,
 * and the delivered-key ledger stops a late-landing send from being sent twice.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    work.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      // Forward the original rejection untouched - wrapping it would hide the real
      // transport error from the caller that logs it.
      (error: unknown) => {
        clearTimeout(timer);
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error);
      }
    );
  });
}
