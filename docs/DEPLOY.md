# Deploying Power Roast (hosted mode)

How to run the bot + scheduler on your own server. You need:

- A small VPS with Docker installed (1 vCPU / 1 GB is plenty)
- A PostgreSQL database (a managed one like [Neon](https://neon.tech) has a free tier, or run your own)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Optional: any HTTP uptime monitor pointed at the `/health` endpoint

## 1. Apply the database schema

From your dev machine:

```powershell
$env:DATABASE_URL = '<your postgres connection string>'
bun run db:migrate
```

Repeat this step whenever a new migration lands in `drizzle/`. The deploy
workflow (`.github/workflows/deploy.yml`) does this on every push to `main` as
a safety net — the image only gets built and pushed to GHCR if the migration
succeeds.

## 2. Server setup (once)

SSH into the server:

```bash
# Docker, if not already installed
curl -fsSL https://get.docker.com | sh

# App
git clone <your-repo-url> /opt/power-roast
cd /opt/power-roast
cp .env.example .env
nano .env   # fill in the values below
```

Minimal production `.env`:

```env
DATABASE_URL=postgres://...?sslmode=require
TELEGRAM_BOT_TOKEN=123456:ABC...
ADMIN_CHAT_ID=<your telegram chat id, for /stats, /grant, and operator alarms>
POLL_INTERVAL_HOURS=6
REMINDER_INTERVAL_HOURS=24
# Where /dashboard links point - your server's public address
PUBLIC_BASE_URL=http://<server-ip>:3000
# Recharge link embedded in alert messages. Defaults to the DESCO portal;
# uncomment only if they change their URL or you point at a mirror.
#RECHARGE_URL=https://prepaid.desco.org.bd/
```

Optional features (see `.env.example` for the full reference):

- **SMS alerts**: `SMS_GATEWAY=bulksmsbd` + `BULKSMSBD_API_KEY` + `BULKSMSBD_SENDER_ID`
- **Billing**: `BILLING_PROVIDER` defaults to `none` - paid plans are off and
  `/upgrade` replies "coming soon" (the free-only launch default). `bkash` and
  `sslcommerz` are live gateways; `sandbox` auto-approves upgrades for free and is
  for dev only. See [Billing](#7-billing-paid-plans).
- **DESCO upstream TLS**: `DESCO_TLS_INSECURE=1` skips certificate verification
  on calls to `prepaid.desco.org.bd` only. Leave unset in production unless
  DESCO's certificate chain breaks; the bypass is scoped to the DESCO client.

Start it:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f   # watch the first poll cycle
```

Open the firewall for SSH and the health endpoint only:

```bash
ufw allow OpenSSH
ufw allow 3000/tcp
ufw enable
```

## 3. Deploying updates

The `.github/workflows/deploy.yml` workflow runs `bun run db:migrate` against
your production DB and builds + pushes a fresh image to GHCR on every push to
`main`. To roll out on the server:

```bash
cd /opt/power-roast
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

`docker compose pull` is a no-op if the `:latest` tag hasn't changed since
your last deploy.

If you skip the GitHub workflow (e.g. testing on a non-main branch), the
manual flow still works:

```bash
cd /opt/power-roast
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

(If the update includes a new migration, run step 1 against your database first.)

## 4. HTTPS

Dashboard links carry an auth token in the URL - over plain HTTP they're
sniffable in transit. Put [Caddy](https://caddyserver.com) in front (automatic
Let's Encrypt certificates) once you have a domain pointed at the server:

```bash
apt install -y caddy
cat > /etc/caddy/Caddyfile <<'EOF'
app.yourdomain.com {
    reverse_proxy localhost:3000
}
EOF
systemctl reload caddy

ufw allow 80/tcp
ufw allow 443/tcp
ufw delete allow 3000/tcp   # only Caddy talks to the app now
```

Then set `PUBLIC_BASE_URL=https://app.yourdomain.com` in `.env`, restart the
app, and point your uptime monitor at `https://app.yourdomain.com/health`.

## 5. Monitoring

Point any uptime monitor at `http://<server-ip>:3000/health` and alert on non-200.

The endpoint returns **503** in three situations:

- A poll cycle is overdue (more than 2x the poll interval since the last
  completed cycle) — so it catches a wedged poller, not just a dead process.
- A `SELECT 1` against the database doesn't respond within 2s — the DB is
  unreachable from the app even if the process is alive.
- The app hasn't been up long enough to complete its first cycle (within the
  first poll interval).

A 5–15 minute check interval is plenty.

You also get in-app alarms: the scheduler messages `ADMIN_CHAT_ID` on Telegram
if more than half the meters in a cycle fail (likely a provider API change or
block), and `/stats` shows users / meters / readings / alerts on demand.

## 6. Email channel (optional)

The email sender speaks plain SMTP. To enable it, set `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` (an address on a domain with proper
SPF/DKIM) in `.env`. Any transactional email provider works.

## 7. Billing (paid plans)

`BILLING_PROVIDER=none` (default) keeps paid plans off - `/upgrade` replies
"coming soon", so you can launch free-only without a merchant account. Switch to
a real gateway when you're ready to charge. `BILLING_PROVIDER=sandbox`
auto-approves every `/upgrade` for free - good for testing, never for production.
Two real gateways are implemented:

```env
# bKash Tokenized Checkout
BILLING_PROVIDER=bkash
BKASH_APP_KEY=...
BKASH_APP_SECRET=...
BKASH_USERNAME=...
BKASH_PASSWORD=...
# BKASH_BASE_URL defaults to the sandbox; set the production host once approved

# or SSLCommerz
BILLING_PROVIDER=sslcommerz
SSLCOMMERZ_STORE_ID=...
SSLCOMMERZ_STORE_PASSWORD=...
# SSLCOMMERZ_BASE_URL defaults to the sandbox; use https://securepay.sslcommerz.com live
```

How the flow works:

1. `/upgrade plus` creates a checkout and replies with a payment link.
2. The user pays on the gateway's hosted page.
3. The gateway redirects/IPNs back to **`PUBLIC_BASE_URL/pay/...`**, the app
   **re-verifies the payment server-side** (it never trusts the redirect's own
   status), records it in the `payments` ledger, activates the plan, and messages
   the user on Telegram.

Requirements:

- **`PUBLIC_BASE_URL` must be publicly reachable and HTTPS** in production - the
  callback carries money state. The same Caddy setup from section 4 covers this.
- Register these callback URLs with your gateway account if it requires
  pre-registration:
  - bKash: `https://app.yourdomain.com/pay/bkash/callback`
  - SSLCommerz success/fail/cancel/IPN are sent automatically at checkout
    creation; just make sure `/pay/sslcommerz/*` is reachable.
- Verify against each gateway's **sandbox** first, then swap creds and `*_BASE_URL`
  to production. The app also exposes `/pay/sslcommerz/ipn` for SSLCommerz's
  server-to-server confirmation (recommended - it lands even if the user closes
  the browser before the redirect).

Use `/grant <chat id> <plan> [days]` (admin only) to comp a plan without payment.

## 8. Operations runbook

- **App won't start with "Missing required environment variables"**: set
  `DATABASE_URL` and `TELEGRAM_BOT_TOKEN` (server mode) or the seven
  `DESCO_*` / `EMAIL_*` / `SMTP_*` vars (self-hosted CLI mode).
- **`/health` returns 503 `db-down`**: the app can't reach Postgres. Check
  the `DATABASE_URL`, network ACLs, and that Neon (or your DB) isn't paused.
- **`/health` returns 503 `stale`**: poll cycle is wedged. Check the app logs
  for fetch failures — usually DESCO upstream changes; the operator alarm in
  `ADMIN_CHAT_ID` is your fastest signal.
- **DESCO certificate errors in logs**: set `DESCO_TLS_INSECURE=1` and restart.
  The bypass is scoped to the DESCO client.
- **Alerts firing twice**: shouldn't happen anymore (the outbox pattern
  serializes dispatch). If you see duplicates after upgrading, check the
  `pending_alerts` table — anything with `status='sent'` should be terminal.
- **`/health` is green but alerts aren't going out**: the worker may be
  wedged. Run `SELECT status, count(*) FROM pending_alerts GROUP BY status`
  — a growing `pending` count with a recent `created_at` means the
  dispatcher isn't draining. The scheduler also fires an alarm in
  `ADMIN_CHAT_ID` when a row is stuck >2 min or a new `failed` row appears
  in the last 24h.
- **Backups**: schedule a daily `pg_dump` of the production DB. The outbox,
  payments, subscriptions, and meter history live in one database; a
  single accidental `DROP TABLE` is a real cost. Managed providers (Neon,
  RDS) ship a free daily backup tier — turn it on even if you also run
  your own.
- **Need to scrub PII from logs**: stdout is masked by the in-process logger
  (emails, phones, account/meter numbers). For log shippers (Datadog, etc.),
  add a redaction processor at the agent level.
