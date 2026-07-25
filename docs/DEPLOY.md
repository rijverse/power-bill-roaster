# Deploying Power Roast (hosted mode)

How to run the bot + scheduler on your own server. You need:

- A small VPS with Docker installed (1 vCPU / 1 GB is plenty)
- A PostgreSQL database (a managed one like [Neon](https://neon.tech) has a free tier, or run your own)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- **Strongly recommended: an external HTTP uptime monitor pointed at `/health`**
  (see [Monitoring](#5-monitoring) — it's the backstop for a wedged process)

## 1. Apply the database schema

From your dev machine:

```powershell
$env:DATABASE_URL = '<your postgres connection string>'
bun run db:migrate
```

Repeat this step whenever a new migration lands in `drizzle/`. The deploy
workflow (`.github/workflows/deploy.yml`) does this on every push to `main` as
a safety net - the image only gets built and pushed to GHCR if the migration
succeeds.

### Baselining a database that predates a migration squash

If the migration history was ever squashed (several migrations collapsed into a
single `0000_init.sql`), a database that already ran the old migrations fails
`db:migrate` with `relation "..." already exists`: drizzle sees the new baseline
as unapplied and tries to recreate tables that are already there. Fresh databases
are unaffected; only pre-squash ones need reconciling.

Tell drizzle the baseline is already applied by recording it in the migrations
table. Run this once against that database, after confirming its schema already
matches `0000_init.sql`:

```bash
# the hash drizzle expects for the baseline file
hash=$(node -e "const c=require('crypto'),fs=require('fs');console.log(c.createHash('sha256').update(fs.readFileSync('drizzle/0000_init.sql')).digest('hex'))")
# the "when" timestamp for the 0000_init entry
when=$(node -e "console.log(require('./drizzle/meta/_journal.json').entries[0].when)")

psql "$DATABASE_URL" <<SQL
DELETE FROM drizzle."__drizzle_migrations";
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES ('$hash', $when);
SQL
```

After that, `db:migrate` is a no-op on that database and future migrations apply
normally.

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
  for dev only. See [Billing](#8-billing-paid-plans).
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

On every push to `main`, `.github/workflows/deploy.yml` runs the full CI suite
(lint, tests, build, a fresh-DB migration check, and the mocked e2e), and only if
that all passes does it apply pending migrations to your production DB and build +
push a fresh image to GHCR, tagged both `:latest` and `:<commit-sha>`. A red build
never touches prod.

To roll out on the server, use the deploy script - it pulls, restarts, waits for
`/health`, and rolls back to the previous image if the new one never goes healthy:

```bash
cd /opt/power-roast
git pull                 # get the latest scripts/deploy.sh + compose files
./scripts/deploy.sh
```

`docker compose pull` (inside the script) is a no-op if the `:latest` tag hasn't
changed since your last deploy. If you'd rather run it by hand, the underlying
steps are just `docker compose -f docker-compose.prod.yml pull` then `... up -d`,
followed by a `curl -f http://localhost:3000/health` to confirm.

**Keep migrations backward-compatible.** The workflow migrates prod *before* the
new image ships, and a failed rollout falls back to the previous image, so the
old code must keep working against the new schema. Use expand/contract: add
columns/tables in one release, backfill and switch reads, drop the old shape only
in a later release once nothing runs against it.

To roll back (or pin a specific build), set `IMAGE_TAG` to a commit sha in
`.env` and re-run the two commands above — it defaults to `latest`:

```env
IMAGE_TAG=<commit-sha from the good build>
```

If you're running your own fork, set `IMAGE_REPO=<your-owner>/power-bill-roaster`
in `.env` so it pulls your image instead of the upstream one.

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

Then set `PUBLIC_BASE_URL=https://app.yourdomain.com` and `TRUST_PROXY=1` in
`.env`, restart the app, and point your uptime monitor at
`https://app.yourdomain.com/health`. `TRUST_PROXY=1` tells the rate limiters to
read the client IP from Caddy's `X-Forwarded-For`; leave it unset any time the
app's port is reachable directly, or the header can be spoofed to bypass them.

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

**Wire this before or at launch — it is the process-wedge backstop.** An
unhandled promise rejection is deliberately *logged, not fatal* (one stray
floating promise usually isn't grounds to tear down a process mid-cycle), so a
rejection that leaves shared state half-dead won't crash the container on its
own. The `/health` staleness check (503 after ~2× the poll interval) is what
turns that into a visible failure — but only if an external monitor is actually
polling `/health` and paging you. Without one, a wedged poller can sit silent
for up to two poll intervals. (`uncaughtException`, by contrast, still exits
non-zero so Docker restarts the container.)

You also get in-app alarms: the scheduler messages the operator if more than
half the meters in a cycle fail (likely a provider API change or block), and
`/stats` shows users / meters / readings / alerts on demand. Operator alarms and
dead-letter pings go to `ADMIN_CHAT_ID` on Telegram and/or `ADMIN_DISCORD_USER_ID`
on Discord — set at least one (a Discord-only deploy that sets neither gets no
operator alarms).

**Run a single app instance.** The poll cycle is multi-instance-safe (a Postgres
advisory lock means only one instance polls) and the outbox worker uses
`FOR UPDATE SKIP LOCKED`, but the login/OTP/DESCO-lookup rate limiters are
in-memory per process, and the monthly SMS budget check isn't atomic across
concurrent dispatches. Running two or more instances would weaken those throttles
and could let SMS overshoot the plan budget. Scale vertically; if you ever need
horizontal scale, move the rate-limit/OTP state to shared storage (e.g. Redis)
and gate the SMS budget in the database first.

## 6. Email — required for accounts

Accounts are created only by verified-email signup on the web dashboard (the chat
bots no longer create accounts or register meters), so **email must be configured
or nobody can sign up.** The sender speaks plain SMTP: set `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` (an address on a domain
with proper SPF/DKIM) in `.env`. Any transactional email provider works. It powers
both magic-link sign-in and email alerts.

Discord webhooks need no server config: a user pastes a channel webhook URL into
`/discord <url>` in Telegram, `/webhook <url>` in Discord, or the web app's Alerts
screen; the app validates it, fires a test message, and stores the URL against
their account. Deleting the account (or `/discord off`) removes it.

## 7. Discord bot (optional)

The same product as the Telegram bot, on Discord: users run read-only slash
commands (`/balance`, `/meters`, `/connect`, …) and get their alerts as DMs from
the bot. Meters are managed on the web dashboard, not the bot. It's off until the
three `DISCORD_*` variables are set. The per-user webhook channel (`/discord` in
Telegram, `/webhook` in Discord) works with or without it.

Setup, once:

1. Create an app at <https://discord.com/developers/applications>. From
   **General Information**, copy the **Application ID** and **Public Key**;
   from **Bot**, copy the **token**. Put them in `.env`:

   ```env
   DISCORD_APP_ID=...
   DISCORD_PUBLIC_KEY=...
   DISCORD_BOT_TOKEN=...
   ```

2. Restart the app. It bulk-registers the slash-command set at boot (watch for
   `Discord slash commands registered` in the logs; the set lives in
   `src/discord/command-defs.ts`).

3. Back in the portal, set **General Information → Interactions Endpoint URL**
   to `https://<your PUBLIC_BASE_URL host>/discord/interactions`. Discord
   immediately probes it with signed (and deliberately mis-signed) requests, so
   the app must already be running and reachable over HTTPS - do this after
   step 2, with the section-4 Caddy setup in place. The endpoint rejects
   anything that fails ed25519 signature verification.

4. Generate an invite from **Installation** (or OAuth2 URL generator) with the
   `bot` + `applications.commands` scopes - no bot permissions are needed
   beyond DMs. Users invite it to a server (or install it), sign up on the web,
   then run `/connect` to link Discord to their account.

Operational notes:

- **DM delivery can fail** for users who block DMs from server members. When a
  DM bounces, the outbox marks that delivery failed and retries like any other
  channel; a channel webhook (`/webhook`) is the fallback.
- **One account across platforms**: `/connect` in Discord replies with a
  `PUBLIC_BASE_URL/app/connect/discord?token=...` link. Opening it (while signed
  in on the web) attaches Discord to that account, merging a legacy Discord-only
  account into it if one exists. The web app's Connect Telegram flow chains into
  the same account from the other direction.
- The bot **never reads messages** - it only receives slash-command
  interactions on the HTTPS endpoint, so there's no gateway connection to
  babysit and no privileged intents to request.
- **Local dev:** Discord must reach the endpoint, so use a tunnel
  (`cloudflared tunnel --url http://localhost:3000`) and point the portal at
  the tunnel URL, or just test through the unit suite - the endpoint,
  signature check, and commands are all covered.

## 8. WhatsApp channel (optional)

Alerts over WhatsApp, plus a connect flow keyed to the user's dashboard account.
Off until all five `WHATSAPP_*` variables are set (a partial set refuses to boot).

> The outbound sender is **stubbed** today: it logs instead of calling Meta, so
> the channel, connect webhook, and dashboard button are all live but no real
> WhatsApp message goes out until the Cloud API sender is wired
> (`src/notifications/whatsapp`). Everything below is the setup that sender needs.

Setup, once:

1. Create a Meta app with WhatsApp (Cloud API) at
   <https://developers.facebook.com/>. From the WhatsApp setup copy the **Phone
   number ID** and an **access token**; from **App Settings → Basic** copy the
   **App Secret**. Choose any string for the webhook verify token. Put them in
   `.env`:

   ```env
   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_ACCESS_TOKEN=...
   WHATSAPP_VERIFY_TOKEN=<any secret string>
   WHATSAPP_APP_SECRET=...
   WHATSAPP_DISPLAY_NUMBER=8801XXXXXXXXX   # business number, digits only, for wa.me links
   ```

2. Restart the app. `/whatsapp/webhook` now serves the GET handshake and signed
   POST events (it 404s while WhatsApp is unset).

3. In the Meta app's **WhatsApp → Configuration**, set the **Callback URL** to
   `https://<your PUBLIC_BASE_URL host>/whatsapp/webhook`, the **Verify token** to
   your `WHATSAPP_VERIFY_TOKEN`, then subscribe to the `messages` field. Meta
   probes the URL with the handshake; the app echoes the challenge only when the
   token matches, and rejects any POST whose `X-Hub-Signature-256` HMAC (over the
   raw body, keyed by the App Secret) doesn't check out.

How a user connects: on the dashboard **Alerts** screen they tap **Connect
WhatsApp**, which opens WhatsApp with a signed `connect <token>` message
prefilled. They send it; the inbound webhook verifies the token and attaches their
number as a verified WhatsApp channel on the account that minted it.

## 9. Billing (paid plans)

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

## 10. Operations runbook

- **App won't start with "Missing required environment variables"**: set
  `DATABASE_URL` and `TELEGRAM_BOT_TOKEN` (server mode) or the seven
  `DESCO_*` / `EMAIL_*` / `SMTP_*` vars (self-hosted CLI mode).
- **App won't start with "Refusing to connect to a remote database without
  TLS"**: your `DATABASE_URL` points at a non-local host with no TLS. The app
  refuses to push customer PII and payment references over a plaintext link.
  Fix it by appending `?sslmode=require` to `DATABASE_URL` (recommended), or —
  only if the database is on a trusted private network — set `ALLOW_INSECURE_DB=1`.
  `localhost` / `127.0.0.1` / `::1` are exempt, so local dev and the compose
  sidecar Postgres are unaffected. This guard is new; a pre-existing deploy
  whose URL lacked `sslmode` needs this one-line `.env` touch-up on first
  upgrade.
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

## 11. Security hardening (prod)

The production compose (`docker-compose.prod.yml`) runs the container hardened:

- **Read-only filesystem** (`read_only: true` with a `/tmp` tmpfs). The app
  writes nothing to disk at runtime; logs go to stdout, data to Postgres.
- **All Linux capabilities dropped** (`cap_drop: [ALL]`), no privilege
  escalation (`no-new-privileges`), and resource limits (`mem_limit: 512m`,
  `cpus: 1.0`, `pids_limit: 200`).
- **`__Host-` cookie prefix** under HTTPS. Session cookies are named
  `__Host-pr_admin` / `__Host-pr_user` (requires `Secure` + `Path=/`), so a
  vulnerable subdomain can't inject a cookie that shadows the session.
  Over dev HTTP the plain names apply (the prefix requires `Secure`).
- **SMTP STARTTLS required** on port 587/25. A network MITM can't strip the
  `STARTTLS` ad and carry magic links / alert bodies in cleartext.
- **Billing gateway URLs must be `https`** (or `http://localhost` for a local
  sandbox). A misconfigured `http://` gateway would leak credentials.
- **CSP pins the exact Chart.js bundle**, not the whole `cdn.jsdelivr.net`
  origin, so a stored-XSS payload can't pull an arbitrary jsdelivr script.
- **Backup retention vs erasure**: `/delete` is a hard delete against the live
  DB. An `admin_audit` trail of operator actions is intentionally retained
  (disclosed in the `/privacy` text). If you restore a managed-DB backup
  (Neon, RDS), deleted users can reappear — set a backup-retention window
  consistent with your erasure obligations.
