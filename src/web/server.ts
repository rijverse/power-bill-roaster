import http from 'http';
import crypto from 'crypto';
import { sql } from 'drizzle-orm';
import { Db } from '../db';
import { Scheduler } from '../core/scheduler';
import { SubscriptionService } from '../billing';
import { billingLive } from '../core/plans';
import { ServerConfig } from '../config';
import { verifyDashboardToken } from './token';
import { dashboardHtml } from './dashboard-html';
import { pageDoc, logo } from './theme';
import { dashboardData } from './queries';
import { handleAdminRequest } from './admin';
import { handleAppRequest } from './app';
import { homeHtml, HERO_GRID_JS } from './home-html';
import { Mailer } from '../services/mailer';
import { RateLimiter } from '../core/rate-limiter';
import { handleDiscordInteraction, DiscordInteractionDeps } from '../discord/interactions';
import {
  handleWhatsAppVerification,
  handleWhatsAppEvent,
  WhatsAppInboundDeps,
} from '../notifications/whatsapp/webhook';
import { json, readBody } from './http-utils';
import { pollIsStale } from '../core/health';
import { logger } from '../logger';

// cap the db ping so a stalled connection doesn't make /health hang past
// what an uptime monitor is willing to wait.
const DB_PING_TIMEOUT_MS = 2_000;
// Blunt brute-forcing the admin password without locking out a fat-fingered operator.
const ADMIN_LOGIN_ATTEMPTS = 10;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Aggregate cap across all IPs. With a single operator this only trips under a
// distributed / IP-rotating brute force, never legitimate use.
const ADMIN_LOGIN_GLOBAL_ATTEMPTS = 50;
// Customer web app: cap magic-link emails (anti email-bombing) and DESCO
// lookups on add-meter (politeness to the upstream API).
const APP_LOGIN_SENDS = 5;
const APP_LOGIN_WINDOW_MS = 15 * 60 * 1000;
// The sign-in code is a stateless 6 digits (user-auth.ts), so the attempt budget
// is the only thing standing between a guesser and an account. Both of these are
// keyed *without* the client IP: behind a proxy the IP is only as trustworthy as
// the proxy is, and an IP-rotating attacker would otherwise get an unbounded
// budget. Per-email stops a targeted grind, the global one stops a wide sweep.
const APP_CODE_ATTEMPTS = 10;
const APP_LOGIN_GLOBAL_ATTEMPTS = 200;
const APP_METER_LOOKUPS = 6;
const APP_METER_WINDOW_MS = 10 * 60 * 1000;
// Operator "re-check balance now" politeness cap toward DESCO, keyed per meter.
const ADMIN_RECHECKS = 10;
const ADMIN_RECHECK_WINDOW_MS = 10 * 60 * 1000;

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] ?? c
  );
}

/**
 * Defense-in-depth headers on every response, set before routing so the admin
 * panel (customer PII), the customer app, and the token-bearing dashboard links
 * all get them. Inline scripts need the per-request nonce; styles stay
 * 'unsafe-inline' because the pages lean on style="" attributes, which nonces
 * can't cover. The jsdelivr script-src is pinned to the exact Chart.js bundle
 * every page loads (not the whole CDN), so a stored-XSS payload can't pull an
 * arbitrary jsdelivr script. Google Fonts (Inter + JetBrains Mono) are
 * allow-listed because every page relies on them; everything else is
 * same-origin only, framing is denied (clickjacking), and X-Robots-Tag keeps
 * these pages - and the auth tokens in their URLs - out of search engines.
 */
function applySecurityHeaders(res: http.ServerResponse, secure: boolean, nonce: string): void {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self' https://fonts.gstatic.com",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; ')
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

/** Branded user-facing page shown after a payment redirect. */
function payPage(res: http.ServerResponse, status: number, title: string, message: string): void {
  const body =
    `<div style="position:relative;z-index:1;min-height:100vh;display:grid;place-items:center;padding:32px 20px;">` +
    `<div class="pr-card" style="max-width:440px;width:100%;text-align:center;">` +
    `<div style="display:flex;justify-content:center;margin-bottom:18px">${logo(true)}</div>` +
    `<h1 style="font-size:22px;font-weight:800;color:var(--text);letter-spacing:-0.02em;margin:0 0 8px">${escapeHtml(title)}</h1>` +
    `<p style="color:var(--text-2);line-height:1.55;margin:0">${escapeHtml(message)}</p>` +
    `<p class="muted" style="font-size:13px;margin:14px 0 0">You can close this tab and head back to Telegram.</p>` +
    `</div></div>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pageDoc(title, body));
}

/** Branded page for an expired or invalid dashboard link (the /dash HTML route). */
function expiredDashPage(res: http.ServerResponse, config: ServerConfig): void {
  const title = 'Link expired';
  const button = config.botUsername
    ? `<a href="https://t.me/${encodeURIComponent(config.botUsername)}" class="pr-btn blue" style="text-decoration:none;display:inline-block;margin-top:18px">Open Telegram</a>`
    : '';
  const body =
    `<div style="position:relative;z-index:1;min-height:100vh;display:grid;place-items:center;padding:32px 20px;">` +
    `<div class="pr-card" style="max-width:440px;width:100%;text-align:center;">` +
    `<div style="display:flex;justify-content:center;margin-bottom:18px">${logo(true)}</div>` +
    `<h1 style="font-size:22px;font-weight:800;color:var(--text);letter-spacing:-0.02em;margin:0 0 8px">${escapeHtml(title)}</h1>` +
    `<p style="color:var(--text-2);line-height:1.55;margin:0">Dashboard links expire for your security. Open Telegram and send /dashboard to get a fresh one.</p>` +
    button +
    `</div></div>`;
  res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pageDoc(title, body));
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
  mailer: Mailer | null = null,
  discordInteractions: DiscordInteractionDeps | null = null,
  whatsappInbound: WhatsAppInboundDeps | null = null
): http.Server {
  const startedAt = Date.now();
  // fully static and search-engine indexed - built once and memoized on first
  // hit, not per crawl hit. paid pricing/upsell is hidden until a billing
  // gateway is switched on.
  let homePage: string | null = null;
  const loginLimiter = new RateLimiter(ADMIN_LOGIN_ATTEMPTS, ADMIN_LOGIN_WINDOW_MS);
  const loginGlobalLimiter = new RateLimiter(ADMIN_LOGIN_GLOBAL_ATTEMPTS, ADMIN_LOGIN_WINDOW_MS);
  const appLoginLimiter = new RateLimiter(APP_LOGIN_SENDS, APP_LOGIN_WINDOW_MS);
  const appEmailLimiter = new RateLimiter(APP_CODE_ATTEMPTS, APP_LOGIN_WINDOW_MS);
  const appLoginGlobalLimiter = new RateLimiter(APP_LOGIN_GLOBAL_ATTEMPTS, APP_LOGIN_WINDOW_MS);
  const appMeterLimiter = new RateLimiter(APP_METER_LOOKUPS, APP_METER_WINDOW_MS);
  const adminRecheckLimiter = new RateLimiter(ADMIN_RECHECKS, ADMIN_RECHECK_WINDOW_MS);
  const secure = (config.publicBaseUrl ?? '').startsWith('https');

  return http.createServer((req, res) => {
    void (async () => {
      const nonce = crypto.randomBytes(16).toString('base64');
      applySecurityHeaders(res, secure, nonce);
      const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);

      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        await handleAdminRequest(req, res, {
          db,
          config,
          subscriptions,
          loginLimiter,
          loginGlobalLimiter,
          recheckLimiter: adminRecheckLimiter,
          scheduler,
          nonce,
        });
        return;
      }

      if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
        await handleAppRequest(req, res, {
          db,
          config,
          mailer,
          subscriptions,
          loginLimiter: appLoginLimiter,
          emailLimiter: appEmailLimiter,
          loginGlobalLimiter: appLoginGlobalLimiter,
          meterLimiter: appMeterLimiter,
          nonce,
        });
        return;
      }

      // Discord's interactions endpoint. Signature verification needs the raw
      // body, so it's read here (with the shared size cap) and passed down.
      if (url.pathname === '/discord/interactions') {
        if (!discordInteractions) {
          res.writeHead(404).end();
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405).end();
          return;
        }
        const rawBody = await readBody(req);
        await handleDiscordInteraction(req, res, rawBody, discordInteractions);
        return;
      }

      // WhatsApp Cloud API webhook: GET is Meta's subscribe handshake, POST is a
      // signed message event. Config-gated like the Discord endpoint.
      if (url.pathname === '/whatsapp/webhook') {
        if (!whatsappInbound) {
          res.writeHead(404).end();
          return;
        }
        if (req.method === 'GET') {
          handleWhatsAppVerification(url, res, whatsappInbound);
          return;
        }
        if (req.method === 'POST') {
          const rawBody = await readBody(req);
          await handleWhatsAppEvent(req, res, rawBody, whatsappInbound);
          return;
        }
        res.writeHead(405).end();
        return;
      }

      if (url.pathname === '/health') {
        // ping the db - a dead postgres should flip the monitor red even if
        // the node process is otherwise healthy.
        const dbOk = await Promise.race<boolean>([
          db
            .execute(sql`SELECT 1`)
            .then(() => true)
            .catch(() => false),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), DB_PING_TIMEOUT_MS)),
        ]);
        if (!dbOk) {
          json(res, 503, {
            status: 'db-down',
            lastPollCycleAt: scheduler.lastCycleCompletedAt?.toISOString() ?? null,
          });
          return;
        }
        const intervalMs = config.pollIntervalHours * 60 * 60 * 1000;
        const last = scheduler.lastCycleCompletedAt;
        const overdue = pollIsStale(last, startedAt, intervalMs);
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
          // /dash/data feeds the SPA, which handles a JSON 401 itself; a person
          // hitting the /dash link directly gets a branded page, not raw JSON.
          if (url.pathname === '/dash/data') {
            json(res, 401, { error: 'Link expired or invalid. Get a fresh one with /dashboard.' });
          } else {
            expiredDashPage(res, config);
          }
          return;
        }
        if (url.pathname === '/dash/data') {
          json(res, 200, await dashboardData(db, userId));
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(dashboardHtml(nonce, url.searchParams.get('t')!));
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

      // Static hero animation for the landing page. Same-origin so it loads
      // under script-src 'self' with no nonce, which keeps the / page memoized.
      if (url.pathname === '/assets/hero-grid.js') {
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(HERO_GRID_JS);
        return;
      }

      if (url.pathname === '/') {
        // public marketing page - let search engines index it (every other
        // route keeps the noindex set in applySecurityHeaders).
        res.setHeader('X-Robots-Tag', 'index, follow');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        homePage ??= homeHtml(billingLive(config.billing));
        res.end(homePage);
        return;
      }

      res.writeHead(404).end();
    })().catch((error: unknown) => {
      logger.error('Web request failed', error);
      if (!res.headersSent) {
        json(res, 500, { error: 'Something broke on our side.' });
      }
    });
  });
}
