import { Agent } from 'undici';
import { fetchWithTimeout } from '../core/http';
import { ApiResponse, BalanceData } from '../types';

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

    const response = await fetchWithTimeout(url, { dispatcher: insecureDispatcher });
    const apiResponse: unknown = await response.json();

    if (!validateApiResponse(apiResponse)) {
      throw new Error('Invalid API response: missing or invalid data');
    }

    return apiResponse.data;
  }
}
