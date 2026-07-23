import { SslcommerzProvider, mapSslcommerzStatus } from '../../billing/sslcommerz';

const mockFetch = jest.spyOn(globalThis, 'fetch');
mockFetch.mockImplementation(async () => {
  throw new Error('fetch should be replaced per test');
});

const config = {
  storeId: 'store',
  storePassword: 'pw',
  baseUrl: 'https://sandbox.example',
  publicBaseUrl: 'https://app.example',
};

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as never;
}

function errorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error('not JSON');
    },
    text: async () => body,
  } as never;
}

describe('mapSslcommerzStatus', () => {
  it('maps validation states to payment status', () => {
    expect(mapSslcommerzStatus('VALID')).toBe('paid');
    expect(mapSslcommerzStatus('VALIDATED')).toBe('paid');
    expect(mapSslcommerzStatus('PENDING')).toBe('pending');
    expect(mapSslcommerzStatus(undefined)).toBe('pending');
    expect(mapSslcommerzStatus('FAILED')).toBe('failed');
    expect(mapSslcommerzStatus('EXPIRED')).toBe('failed');
  });
});

describe('SslcommerzProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a session and returns the gateway URL keyed by tran_id', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: 'SUCCESS', GatewayPageURL: 'https://gw/pay', sessionkey: 'sk' })
    );

    const provider = new SslcommerzProvider(config);
    const checkout = await provider.createCheckout({
      userId: 3,
      plan: 'business',
      amountBdt: 250,
      reference: 'u3-business-1',
    });

    expect(checkout).toEqual({ externalRef: 'u3-business-1', paymentUrl: 'https://gw/pay' });
    const body = mockFetch.mock.calls[0][1] as { body: string };
    expect(body.body).toContain('tran_id=u3-business-1');
    expect(body.body).toContain(
      'success_url=https%3A%2F%2Fapp.example%2Fpay%2Fsslcommerz%2Fsuccess'
    );
  });

  it('throws when the session is not created', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: 'FAILED', failedreason: 'Invalid store credentials' })
    );

    const provider = new SslcommerzProvider(config);
    await expect(
      provider.createCheckout({ userId: 1, plan: 'plus', amountBdt: 40, reference: 'r' })
    ).rejects.toThrow('SSLCommerz session failed');
  });

  it('verifyPayment returns paid for a VALID transaction', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ element: [{ status: 'VALID' }] }));

    const provider = new SslcommerzProvider(config);
    await expect(provider.verifyPayment('u3-business-1')).resolves.toBe('paid');
    expect(mockFetch.mock.calls[0][0]).toContain('tran_id=u3-business-1');
  });

  it('verifyPayment returns pending when no transaction is recorded yet', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ no_of_trans_found: 0, element: [] }));

    const provider = new SslcommerzProvider(config);
    await expect(provider.verifyPayment('r')).resolves.toBe('pending');
  });

  it('autoConfirms is false (async confirmation via IPN/redirect)', () => {
    expect(new SslcommerzProvider(config).autoConfirms).toBe(false);
  });

  it('throws a meaningful error when createCheckout gets a non-2xx HTML response', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(503, '<html>Service Unavailable</html>'));
    const provider = new SslcommerzProvider(config);
    await expect(
      provider.createCheckout({ userId: 1, plan: 'plus', amountBdt: 40, reference: 'r' })
    ).rejects.toThrow('SSLCommerz session returned 503');
  });

  it('throws a meaningful error when verifyPayment gets a non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, '<html>Internal Error</html>'));
    const provider = new SslcommerzProvider(config);
    await expect(provider.verifyPayment('r')).rejects.toThrow('SSLCommerz validation returned 500');
  });
});
