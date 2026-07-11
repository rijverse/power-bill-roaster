import { Agent } from 'undici';
import { fetchWithTimeout } from '../core/http';
import { ApiResponse, BalanceData } from '../types';
import { ProviderUnavailableError, ProviderLookupError } from '../providers/types';

// Overridable for tests (point at a mock server)
const API_BASE_URL =
  process.env.DESCO_API_BASE_URL || 'https://prepaid.desco.org.bd/api/tkdes/customer';

// DESCO's certificate chain has historically been flaky. We only flip this on
// when DESCO_TLS_INSECURE=1 is set - and it's scoped to this client alone, so
// every other outbound call still verifies normally. If real upstream calls
// start failing with cert errors, set the env var and restart.
const insecure = process.env.DESCO_TLS_INSECURE === '1';
const insecureDispatcher = insecure
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : undefined;

function validateApiResponse(response: unknown): response is ApiResponse {
  if (typeof response !== 'object' || response === null) {
    return false;
  }
  const obj = response as Record<string, unknown>;

  if (obj.code !== 200 || typeof obj.data !== 'object' || obj.data === null) {
    return false;
  }

  const data = obj.data as Record<string, unknown>;
  return typeof data.balance === 'number';
}

export class DescoApiClient {
  async getBalance(accountNo: string, meterNo: string): Promise<BalanceData> {
    const url =
      `${API_BASE_URL}/getBalance?accountNo=${encodeURIComponent(accountNo)}` +
      `&meterNo=${encodeURIComponent(meterNo)}`;

    // A failed request (network, timeout, non-JSON) is an availability problem,
    // not a bad meter number - keep the two apart so callers can word the error
    // honestly ("try again" vs "check your numbers").
    let apiResponse: unknown;
    try {
      const response = await fetchWithTimeout(url, { dispatcher: insecureDispatcher });
      apiResponse = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error';
      // undici wraps TLS failures: the cert error code lives on error.cause
      // (typed structurally - the compile target predates Error#cause)
      const causeRaw: unknown =
        error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
      const cause = causeRaw instanceof Error ? causeRaw.message : '';
      // DESCO's chain has broken before; when that's what failed, tell the
      // operator the one-line fix instead of a bare TLS error.
      const certHint = /certificate|CERT_|unable to verify|self.signed/i.test(`${message} ${cause}`)
        ? ' (looks like a TLS certificate error - set DESCO_TLS_INSECURE=1 and restart, see docs/DEPLOY.md)'
        : '';
      throw new ProviderUnavailableError(`DESCO request failed: ${message}${certHint}`);
    }

    if (!validateApiResponse(apiResponse)) {
      throw new ProviderLookupError(
        'DESCO returned no valid balance for that account/meter (the numbers likely do not match)'
      );
    }

    return apiResponse.data;
  }
}
