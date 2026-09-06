import type { Dispatcher } from 'undici';
import { logger, redactUrl } from '../logger';

// every outbound call goes through here so a hung upstream (desco, payment
// gateway, sms provider) can't stall a request or wedge the poll cycle.
// native fetch has no default timeout, so we impose one with an abortcontroller.
const DEFAULT_TIMEOUT_MS = 15_000;

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** undici Dispatcher (e.g. for skipping TLS verification). Optional. */
  dispatcher?: Dispatcher;
}

export async function fetchWithTimeout(
  url: string,
  init: FetchInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // redacted: some upstreams carry api keys and passwords in the query string
      logger.warn(`HTTP timeout after ${timeoutMs}ms: ${redactUrl(url)}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
