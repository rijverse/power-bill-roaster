import fetch, { RequestInfo, RequestInit, Response } from 'node-fetch';

// Every outbound call goes through here so a hung upstream (DESCO's flaky API,
// a payment gateway, the SMS provider) can't stall a request - or, worse, wedge
// the whole sequential poll cycle - indefinitely. node-fetch has no default
// timeout, so we impose one with an AbortController.
const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  url: RequestInfo,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
