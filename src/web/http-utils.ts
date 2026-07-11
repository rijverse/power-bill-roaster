import http from 'http';

// The plumbing every request handler needs, in one place. server.ts, admin.ts and
// app.ts each kept their own copies; they had already drifted (three different
// body caps) and `clientIp` in particular must never fork - it keys the rate
// limiters, so a divergence there is a spoofing bug.

// One cap, not three. server.ts capped at 64 KiB and admin/app at 16 KiB - not a
// deliberate policy, just a stale paste, and the Discord interactions endpoint
// genuinely needs the headroom. Pass `max` to readBody() to tighten a route.
export const MAX_BODY_BYTES = 64 * 1024;

export function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function html(
  res: http.ServerResponse,
  status: number,
  body: string,
  setCookie?: string
): void {
  const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'text/html; charset=utf-8' };
  if (setCookie) {
    headers['Set-Cookie'] = setCookie;
  }
  res.writeHead(status, headers);
  res.end(body);
}

export function redirect(res: http.ServerResponse, location: string, setCookie?: string): void {
  const headers: http.OutgoingHttpHeaders = { Location: location };
  if (setCookie) {
    headers['Set-Cookie'] = setCookie;
  }
  res.writeHead(302, headers);
  res.end();
}

export function readBody(req: http.IncomingMessage, max = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function parseJson(
  req: http.IncomingMessage
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse((await readBody(req)) || '{}');
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Only honor the forwarded address behind a proxy we control (TRUST_PROXY=1).
// Exposed directly it's client-spoofable, and someone could rotate the header to
// slip past the per-IP rate limiters - so fall back to the socket address.
export const trustProxy = process.env.TRUST_PROXY === '1';

export function clientIp(req: http.IncomingMessage): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim();
    if (first) {
      return first;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

/** The echoed CSRF token, whatever shape the header arrives in. */
export function csrfHeader(req: http.IncomingMessage): string {
  const header = req.headers['x-csrf-token'];
  return Array.isArray(header) ? header[0] : (header ?? '');
}

/**
 * True for any method that can change state. The CSRF gate keys off this rather
 * than `=== 'POST'` so a future PUT/PATCH/DELETE route can't ship unprotected by
 * omission.
 */
export function isMutating(method: string | undefined): boolean {
  return method !== 'GET' && method !== 'HEAD';
}
