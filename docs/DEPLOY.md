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

Repeat this step whenever a new migration lands in `drizzle/`.

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
ADMIN_CHAT_ID=<your telegram chat id, for /stats and operator alarms>
POLL_INTERVAL_HOURS=6
REMINDER_INTERVAL_HOURS=24
```

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

```bash
cd /opt/power-roast
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

(If the update includes a new migration, run step 1 against your database first.)

## 4. Monitoring

Point any uptime monitor at `http://<server-ip>:3000/health` and alert on non-200.

The endpoint returns **503 when a poll cycle is overdue** (more than 2x the poll
interval since the last completed cycle) — so it catches a wedged poller, not
just a dead process. A 5–15 minute check interval is plenty.

You also get in-app alarms: the scheduler messages `ADMIN_CHAT_ID` on Telegram
if more than half the meters in a cycle fail (likely a provider API change or
block), and `/stats` shows users / meters / readings / alerts on demand.

## 5. Email channel (optional)

The email sender speaks plain SMTP. To enable it, set `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` (an address on a domain with proper
SPF/DKIM) in `.env`. Any transactional email provider works.
