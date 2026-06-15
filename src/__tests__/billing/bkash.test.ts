import fetch from 'node-fetch';
import { BkashProvider, mapBkashStatus } from '../../billing/bkash';

jest.mock('node-fetch');

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

const config = {
  appKey: 'key',
  appSecret: 'secret',
  username: 'user',
  password: 'pass',
  baseUrl: 'https://tokenized.example/v1.2.0-beta',
  callbackUrl: 'https://app.example/pay/bkash/callback',
};

function jsonResponse(body: unknown) {
  return { json: async () => body } as never;
}

describe('mapBkashStatus', () => {
  it('maps transaction states to payment status', () => {
    expect(mapBkashStatus('Completed')).toBe('paid');
    expect(mapBkashStatus('Initiated')).toBe('pending');
    expect(mapBkashStatus('Authorized')).toBe('pending');
    expect(mapBkashStatus('Cancelled')).toBe('failed');
    expect(mapBkashStatus(undefined)).toBe('failed');
  });
});

describe('BkashProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('grants a token then returns paymentID + bkashURL from create', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id_token: 'tok', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ paymentID: 'PID123', bkashURL: 'https://pay/PID123' }));

    const provider = new BkashProvider(config);
    const checkout = await provider.createCheckout({
      userId: 7,
      plan: 'plus',
      amountBdt: 40,
      reference: 'u7-plus-1',
    });

    expect(checkout).toEqual({ externalRef: 'PID123', paymentUrl: 'https://pay/PID123' });
    // first call grants the token, second creates the payment with auth header
    const createInit = mockFetch.mock.calls[1][1] as { headers: Record<string, string> };
    expect(createInit.headers.Authorization).toBe('tok');
    expect(createInit.headers['X-APP-Key']).toBe('key');
  });

  it('caches the token across calls', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id_token: 'tok', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ paymentID: 'P1', bkashURL: 'u1' }))
      .mockResolvedValueOnce(jsonResponse({ paymentID: 'P2', bkashURL: 'u2' }));

    const provider = new BkashProvider(config);
    const base = { userId: 1, plan: 'plus', amountBdt: 40 };
    await provider.createCheckout({ ...base, reference: 'a' });
    await provider.createCheckout({ ...base, reference: 'b' });

    // 1 grant + 2 creates, not 2 grants
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws when create has no paymentID', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id_token: 'tok' }))
      .mockResolvedValueOnce(
        jsonResponse({ statusCode: '2001', statusMessage: 'Invalid App Key' })
      );

    const provider = new BkashProvider(config);
    await expect(
      provider.createCheckout({ userId: 1, plan: 'plus', amountBdt: 40, reference: 'r' })
    ).rejects.toThrow('bKash create failed');
  });

  it('verifyPayment returns paid when execute completes', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id_token: 'tok' }))
      .mockResolvedValueOnce(jsonResponse({ statusCode: '0000', transactionStatus: 'Completed' }));

    const provider = new BkashProvider(config);
    await expect(provider.verifyPayment('PID')).resolves.toBe('paid');
  });

  it('verifyPayment falls back to status query when execute fails', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id_token: 'tok' }))
      .mockRejectedValueOnce(new Error('already executed'))
      .mockResolvedValueOnce(jsonResponse({ transactionStatus: 'Completed' }));

    const provider = new BkashProvider(config);
    await expect(provider.verifyPayment('PID')).resolves.toBe('paid');
  });

  it('verifyPayment reports pending before authorization', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id_token: 'tok' }))
      .mockResolvedValueOnce(jsonResponse({ statusCode: '2029', transactionStatus: undefined }))
      .mockResolvedValueOnce(jsonResponse({ transactionStatus: 'Initiated' }));

    const provider = new BkashProvider(config);
    await expect(provider.verifyPayment('PID')).resolves.toBe('pending');
  });

  it('autoConfirms is false (async confirmation via callback)', () => {
    expect(new BkashProvider(config).autoConfirms).toBe(false);
  });
});
