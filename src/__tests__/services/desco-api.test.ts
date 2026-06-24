import { DescoApiClient } from '../../services/desco-api';

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
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    client = new DescoApiClient();
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch should be replaced per test');
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('should fetch balance successfully', async () => {
    fetchSpy.mockResolvedValueOnce({
      json: async () => createApiResponse(878.88),
    });

    const result = await client.getBalance('13151091', '661120227647');

    expect(result.balance).toBe(878.88);
    expect(result.accountNo).toBe('13151091');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('accountNo=13151091'),
      expect.any(Object)
    );
  });

  it('should throw error on invalid API response', async () => {
    fetchSpy.mockResolvedValueOnce({
      json: async () => ({ invalid: 'response' }),
    });

    await expect(client.getBalance('123', '456')).rejects.toThrow('Invalid API response');
  });

  it('should throw error on non-200 code', async () => {
    fetchSpy.mockResolvedValueOnce({
      json: async () => ({
        code: 500,
        desc: 'Internal Server Error',
        data: null,
      }),
    });

    await expect(client.getBalance('123', '456')).rejects.toThrow('Invalid API response');
  });

  it('should handle network errors', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    await expect(client.getBalance('123', '456')).rejects.toThrow('Network error');
  });
});
