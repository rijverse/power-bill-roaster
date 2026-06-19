import http from 'http';
import { Db } from '../db';
import { Scheduler } from '../core/scheduler';
import { SubscriptionService } from '../billing';
import { ServerConfig } from '../config';
import { verifyDashboardToken } from './token';
import { dashboardHtml } from './dashboard-html';
import { dashboardData } from './queries';
import { handleAdminRequest } from './admin';
import { handleAppRequest } from './app';
import { Mailer } from '../services/mailer';
import { RateLimiter } from '../core/rate-limiter';

const MAX_BODY_BYTES = 64 * 1024;
// Blunt brute-forcing the admin password without locking out a fat-fingered operator.
const ADMIN_LOGIN_ATTEMPTS = 10;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Customer web app: cap magic-link emails (anti email-bombing) and DESCO
// lookups on add-meter (politeness to the upstream API).
const APP_LOGIN_SENDS = 5;
const APP_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const APP_METER_LOOKUPS = 6;
const APP_METER_WINDOW_MS = 10 * 60 * 1000;

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c
  );
}

/** Minimal user-facing page shown after a payment redirect. */
function payPage(res: http.ServerResponse, status: number, title: string, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${escapeHtml(title)}</title>` +
      `<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;text-align:center}` +
      `h1{font-size:1.4rem}p{color:#444;line-height:1.5}</style></head>` +
      `<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>` +
      `<p>You can close this tab and head back to Telegram.</p></body></html>`
  );
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
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

/** Pull a field from the query string or, for POST callbacks, the form body. */
async function callbackParam(
  req: http.IncomingMessage,
  url: URL,
  field: string
): Promise<string | null> {
  const fromQuery = url.searchParams.get(field);
  if (fromQuery) {
    return fromQuery;
  }
  if (req.method === 'POST') {
    const params = new URLSearchParams(await readBody(req));
    return params.get(field);
  }
  return null;
}

/** Finalize a pending checkout and render the right page for the outcome. */
async function settlePayment(
  res: http.ServerResponse,
  subscriptions: SubscriptionService,
  externalRef: string | null
): Promise<void> {
  if (!externalRef) {
    payPage(res, 400, 'Payment reference missing', 'We could not match this payment to an order.');
    return;
  }
  const result = await subscriptions.finalizePending(externalRef);
  if (result.status === 'paid') {
    payPage(
      res,
      200,
      'Payment confirmed',
      "You're upgraded. Enjoy the extra meters and SMS alerts."
    );
  } else if (result.status === 'pending') {
    payPage(
      res,
      200,
      'Payment processing',
      "We're still confirming with the gateway - your plan unlocks as soon as it clears."
    );
  } else {
    payPage(
      res,
      200,
      'Payment not completed',
      'The payment did not go through. Try /upgrade again whenever you like.'
    );
  }
}

export function createWebServer(
  db: Db,
  scheduler: Scheduler,
  config: ServerConfig,
  subscriptions: SubscriptionService,
  mailer: Mailer | null = null
): http.Server {
  const startedAt = Date.now();
  const loginLimiter = new RateLimiter(ADMIN_LOGIN_ATTEMPTS, ADMIN_LOGIN_WINDOW_MS);
  const appLoginLimiter = new RateLimiter(APP_LOGIN_SENDS, APP_LOGIN_WINDOW_MS);
  const appMeterLimiter = new RateLimiter(APP_METER_LOOKUPS, APP_METER_WINDOW_MS);

  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);

      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        await handleAdminRequest(req, res, { db, config, subscriptions, loginLimiter });
        return;
      }

      if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
        await handleAppRequest(req, res, {
          db,
          config,
          mailer,
          loginLimiter: appLoginLimiter,
          meterLimiter: appMeterLimiter,
        });
        return;
      }

      if (url.pathname === '/health') {
        const intervalMs = config.pollIntervalHours * 60 * 60 * 1000;
        const last = scheduler.lastCycleCompletedAt;
        // allow one full interval of grace before the first cycle completes
        const overdue = last
          ? Date.now() - last.getTime() > intervalMs * 2
          : Date.now() - startedAt > intervalMs;
        json(res, overdue ? 503 : 200, {
          status: overdue ? 'stale' : 'ok',
          lastPollCycleAt: last?.toISOString() ?? null,
        });
        return;
      }

      if (url.pathname === '/dash' || url.pathname === '/dash/data') {
        const userId = verifyDashboardToken(
          url.searchParams.get('t') ?? '',
          config.dashboardSecret
        );
        if (userId === null) {
          json(res, 401, { error: 'Link expired or invalid. Get a fresh one with /dashboard.' });
          return;
        }
        if (url.pathname === '/dash/data') {
          json(res, 200, await dashboardData(db, userId));
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(dashboardHtml(url.searchParams.get('t')!));
        }
        return;
      }

      // bKash redirects here: ?paymentID=...&status=success|failure|cancel
      if (url.pathname === '/pay/bkash/callback') {
        if (url.searchParams.get('status') !== 'success') {
          payPage(res, 200, 'Payment cancelled', 'No charge was made. Run /upgrade to try again.');
          return;
        }
        await settlePayment(res, subscriptions, url.searchParams.get('paymentID'));
        return;
      }

      // SSLCommerz success redirect and server-to-server IPN both confirm by tran_id
      if (url.pathname === '/pay/sslcommerz/success' || url.pathname === '/pay/sslcommerz/ipn') {
        const tranId = await callbackParam(req, url, 'tran_id');
        if (url.pathname === '/pay/sslcommerz/ipn') {
          if (tranId) {
            await subscriptions.finalizePending(tranId);
          }
          json(res, 200, { received: true });
          return;
        }
        await settlePayment(res, subscriptions, tranId);
        return;
      }

      if (url.pathname === '/pay/sslcommerz/fail' || url.pathname === '/pay/sslcommerz/cancel') {
        payPage(res, 200, 'Payment cancelled', 'No charge was made. Run /upgrade to try again.');
        return;
      }

      res.writeHead(404).end();
    })().catch((error: unknown) => {
      console.error('Web request failed:', error);
      if (!res.headersSent) {
        json(res, 500, { error: 'Something broke on our side.' });
      }
    });
  });
}
