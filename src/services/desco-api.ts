import https from 'https';
import { fetchWithTimeout } from '../core/http';
import { ApiResponse, BalanceData } from '../types';

// Overridable for tests (point at a mock server)
const API_BASE_URL =
  process.env.DESCO_API_BASE_URL || 'https://prepaid.desco.org.bd/api/tkdes/customer';

// desco api has certificate issues, so we need to disable verification
// this is a known limitation consider monitoring for certificate updates
// (only applies to https; http mock servers must not receive a tls agent)
const httpsAgent = API_BASE_URL.startsWith('https')
  ? new https.Agent({
      rejectUnauthorized: false,
    })
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

    const response = await fetchWithTimeout(url, { agent: httpsAgent });
    const apiResponse: unknown = await response.json();

    if (!validateApiResponse(apiResponse)) {
      throw new Error('Invalid API response: missing or invalid data');
    }

    return apiResponse.data;
  }
}
