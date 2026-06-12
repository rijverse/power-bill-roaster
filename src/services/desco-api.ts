import fetch from 'node-fetch';
import https from 'https';
import { ApiResponse, BalanceData } from '../types';

const API_BASE_URL = 'https://prepaid.desco.org.bd/api/tkdes/customer';

// desco api has certificate issues, so we need to disable verification
// this is a known limitation consider monitoring for certificate updates
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

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
    const url = `${API_BASE_URL}/getBalance?accountNo=${accountNo}&meterNo=${meterNo}`;

    const response = await fetch(url, { agent: httpsAgent });
    const apiResponse: unknown = await response.json();

    if (!validateApiResponse(apiResponse)) {
      throw new Error('Invalid API response: missing or invalid data');
    }

    return apiResponse.data;
  }
}
