import { fetchWithTimeout } from '../../core/http';

describe('fetchWithTimeout', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch should be replaced per test');
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('passes an abort signal through and returns the response', async () => {
    const fakeResponse = { ok: true } as unknown as Response;
    fetchSpy.mockResolvedValueOnce(fakeResponse);

    const res = await fetchWithTimeout('http://example/x', { method: 'GET' });
    expect(res).toBe(fakeResponse);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('GET');
    expect(init.signal).toBeDefined();
  });

  it('aborts the request once the timeout elapses', async () => {
    fetchSpy.mockImplementationOnce(
      ((_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        })) as never
    );
    await expect(fetchWithTimeout('http://example/slow', {}, 10)).rejects.toThrow('aborted');
  });
});
