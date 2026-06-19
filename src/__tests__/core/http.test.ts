import fetch from 'node-fetch';
import { fetchWithTimeout } from '../../core/http';

jest.mock('node-fetch');

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('fetchWithTimeout', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes an abort signal through and returns the response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as never);
    const res = await fetchWithTimeout('http://example/x', { method: 'GET' });
    expect(res).toEqual({ ok: true });
    const init = mockFetch.mock.calls[0][1] as { method: string; signal: unknown };
    expect(init.method).toBe('GET');
    expect(init.signal).toBeDefined();
  });

  it('aborts the request once the timeout elapses', async () => {
    mockFetch.mockImplementationOnce(
      ((_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        })) as never
    );
    await expect(fetchWithTimeout('http://example/slow', {}, 10)).rejects.toThrow('aborted');
  });
});
