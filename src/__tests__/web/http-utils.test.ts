import http from 'http';
import { listen, closeServers } from '../helpers/http-server';
import { MAX_BODY_BYTES, clientIp, csrfHeader, isMutating, readBody } from '../../web/http-utils';

afterEach(closeServers);

// clientIp keys the rate limiters, so a spoofable value here is a real bypass.
// It used to be defined twice (admin.ts and app.ts) - this pins the one copy.
function fakeReq(headers: http.IncomingHttpHeaders, remoteAddress = '10.0.0.1') {
  return { headers, socket: { remoteAddress } } as unknown as http.IncomingMessage;
}

describe('clientIp', () => {
  it('ignores X-Forwarded-For when TRUST_PROXY is unset', () => {
    // The module reads TRUST_PROXY at import time and it is unset under test,
    // so the forwarded header must not win.
    expect(clientIp(fakeReq({ 'x-forwarded-for': '1.2.3.4' }))).toBe('10.0.0.1');
  });

  it('falls back to the socket address', () => {
    expect(clientIp(fakeReq({}))).toBe('10.0.0.1');
  });

  it('reports "unknown" rather than undefined when there is no socket address', () => {
    const req = { headers: {}, socket: {} } as unknown as http.IncomingMessage;
    expect(clientIp(req)).toBe('unknown');
  });
});

describe('csrfHeader', () => {
  it('reads the token, tolerating a repeated header, and is "" when absent', () => {
    expect(csrfHeader(fakeReq({ 'x-csrf-token': 'abc' }))).toBe('abc');
    expect(csrfHeader(fakeReq({ 'x-csrf-token': ['a', 'b'] }))).toBe('a');
    expect(csrfHeader(fakeReq({}))).toBe('');
  });
});

describe('isMutating', () => {
  it('is false only for safe methods', () => {
    expect(isMutating('GET')).toBe(false);
    expect(isMutating('HEAD')).toBe(false);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isMutating(m)).toBe(true);
    }
  });
});

describe('readBody', () => {
  async function post(body: string, max?: number) {
    const server = http.createServer((req, res) => {
      readBody(req, max)
        .then(b => {
          res.writeHead(200);
          res.end(String(b.length));
        })
        .catch(() => {
          res.writeHead(413);
          res.end();
        });
    });
    const base = await listen(server);
    return fetch(base, { method: 'POST', body });
  }

  it('reads a body under the cap', async () => {
    const res = await post('hello');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('5');
  });

  it('rejects a body over the cap', async () => {
    // readBody destroys the request socket as soon as the cap is breached, so the
    // client never gets a response at all - the point is that we stop reading
    // rather than buffer an unbounded body. Pinning the behavior as it stands.
    await expect(post('x'.repeat(200), 100)).rejects.toThrow();
  });

  it('defaults to 64 KiB - the Discord interactions endpoint needs the headroom', async () => {
    expect(MAX_BODY_BYTES).toBe(64 * 1024);
    const res = await post('x'.repeat(32 * 1024));
    expect(res.status).toBe(200);
  });
});
