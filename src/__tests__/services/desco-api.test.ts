import fetch from 'node-fetch';
import { DescoApiClient } from '../../services/desco-api';

jest.mock('node-fetch');

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

// helper to create mock api response
function createApiResponse(balance: number) {
  return {
    code: 200,
    desc: 'OK',
    data: {
      accountNo: '13151091',
      meterNo: '661120227647',
      balance: balance,
      currentMonthConsumption: 43.1,
      readingTime: '2025-12-03 00:00:00',
    },
  };
}

describe('DescoApiClient', () => {
  let client: DescoApiClient;

  beforeEach(() => {
    client = new DescoApiClient();
    jest.clearAllMocks();
  });

  it('should fetch balance successfully', async () => {
    mockFetch.mockResolvedValue({
      json: async () => createApiResponse(878.88),
    } as any);

    const result = await client.getBalance('13151091', '661120227647');

    expect(result.balance).toBe(878.88);
    expect(result.accountNo).toBe('13151091');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('accountNo=13151091'),
      expect.any(Object)
    );
  });

  it('should throw error on invalid API response', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ invalid: 'response' }),
    } as any);

    await expect(client.getBalance('123', '456')).rejects.toThrow('Invalid API response');
  });

  it('should throw error on non-200 code', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        code: 500,
        desc: 'Internal Server Error',
        data: null,
      }),
    } as any);

    await expect(client.getBalance('123', '456')).rejects.toThrow('Invalid API response');
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(client.getBalance('123', '456')).rejects.toThrow('Network error');
  });
});
