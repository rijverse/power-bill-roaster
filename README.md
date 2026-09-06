# Power-Roast

A TypeScript-based DESCO prepaid electricity monitor that predicts when you'll run out of credit and sends brutally honest alerts before the lights go. Because sometimes you need tough love to remember to recharge.

## What It Does

It watches your DESCO prepaid meter and tells you **when you will actually run
out**, not just that the number looks small. From your recent balance history it
works out how fast you are burning credit and projects the run-out date:

> ~3 days left at this rate, ৳48/day

That projection rides along with every alert, so "৳140 left" becomes "৳140 left,
you go dark Thursday" and you can decide whether to recharge tonight or on payday.

Threshold alerts still fire on the way down:

- **Below 150 BDT** (configurable) Warning shot  "Your Electricity About to Ghost You"
- **Below 100 BDT** (configurable) DEFCON 1  "You're About to Live in the Stone Age"

Every alert carries a one-tap recharge link, and you can snooze the nagging or
re-check the balance on demand right from the message.

## Two Ways to Run It

1. **Self-hosted (free forever) ** just fork this repo, toss your details into GitHub secrets, and the workflow does its thing on a schedule. Zero servers, zero cost. The setup guide below covers this.
2. **Hosted (Telegram + Discord bots)** sign up on the web dashboard with your email, add your meter there, then connect Telegram or Discord to get alerts where you already chat. Run-out predictions ("~3 days left at this rate"), a web dashboard with balance history charts, multi-meter support, free Discord alerts (via a channel webhook or bot DMs), and SMS alerts on paid plans (bKash / SSLCommerz billing). The bots deliver alerts and answer quick commands like `/balance`, `/meters`, and `/connect`. Meters and thresholds are managed on the dashboard. See the [User Guide](docs/USER_GUIDE.md) for end-user steps, or [docs/DEPLOY.md](docs/DEPLOY.md) to deploy your own.

### Operator admin dashboard

The hosted edition ships an operator dashboard at **`/admin`** for managing customers: an
at-a-glance overview, a searchable customer list, and per-customer detail (meters, balance
charts, alerts, subscription) with actions to grant a plan, pause monitoring, or erase an
account. Set `ADMIN_PASSWORD` to enable it (leave it blank and the whole `/admin` route is a
404). It exposes customer data, so only ever serve it over HTTPS.

## Screenshots
<img width="484" height="826" alt="image" src="https://github.com/user-attachments/assets/70212ca2-8a4b-428d-a3c6-5be90eadbf72" />
<img width="458" height="745" alt="image" src="https://github.com/user-attachments/assets/b8ca6f81-705f-4742-aeef-02ddb0367953" />

## Setup

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd power-roast
bun install
```

### 2. Configure Environment Variables

You need your DESCO account and meter numbers, plus **at least one alert channel** 
Discord (one secret) or email (SMTP). Create a `.env` file in the project root:

```env
# Required
DESCO_ACCOUNT_NO=your_account_number
DESCO_METER_NO=your_meter_number

# Easiest channel: Discord (a channel webhook URL)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Or the email channel (set all five together)
#EMAIL_TO=recipient@example.com
#EMAIL_FROM=sender@example.com
#SMTP_HOST=smtp.gmail.com
#SMTP_USER=your_email@gmail.com
#SMTP_PASS=your_app_password

# Optional
SMTP_PORT=587
LOW_THRESHOLD=150
CRITICAL_THRESHOLD=100
```

### 3. Set Up GitHub Secrets

To run automatically on GitHub Actions, add your details as repo **Secrets**  never
**Variables**. Variables are visible to anyone who can read the repo; Actions masks
Secrets in its logs. Go to **Settings → Secrets and variables → Actions**.

Always required:

- `DESCO_ACCOUNT_NO`
- `DESCO_METER_NO`

Then pick at least one channel:

**Easiest: Discord (one more secret)**

- `DISCORD_WEBHOOK_URL`  in Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy URL.

**Email (five more secrets)**

- `EMAIL_TO`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`

Optional (either channel):

- `SMTP_PORT` (defaults to 587)
- `LOW_THRESHOLD` (defaults to 150)
- `CRITICAL_THRESHOLD` (defaults to 100)

### 4. Enable and verify the schedule

GitHub Actions schedules have a couple of gotchas worth knowing:

1. Scheduled workflows are **disabled by default on forks**  open the **Actions** tab once and enable them.
2. **Trigger the workflow manually once** to confirm your secrets work: on the **Actions** tab, pick *Check DESCO Balance* and hit **Run workflow**.
3. GitHub **suspends schedules after ~60 days of no repo activity**. Any commit re-arms them, and GitHub emails you a warning first.

## Usage

### Run Manually

```bash
bun run check-balance
```

### Automated Checks

The GitHub Actions workflow runs once a day at 06:00 UTC on its own. You can also force it to run manually from the **Actions** tab any time (see step 4 above).

## Email Providers

### Gmail Setup

1. Enable 2-Factor Authentication on your Google account
2. Generate an [App Password](https://myaccount.google.com/apppasswords)
3. Use the app password as your `SMTP_PASS`
4. Set `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=587`

### Other Providers

Works with any SMTP provider. Common settings 

- **Outlook**  `smtp-mail.outlook.com:587`
- **Yahoo**  `smtp.mail.yahoo.com:587`
- **Custom SMTP**  Use your provider's settings

## How It Works

1. Double checks all your environment variables
2. Fetches your current balance from DESCO's prepaid API
3. Validates the API response
4. Compares balance against configurable thresholds
5. Blasts out a wildly aggressive alert on every configured channel (Discord and/or email) if you're too low
6. Logs everything for your viewing pleasure

## Configuration

Set the two DESCO variables plus at least one channel (Discord or the full email/SMTP set).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DESCO_ACCOUNT_NO` | ✅ | - | Your DESCO account number |
| `DESCO_METER_NO` | ✅ | - | Your DESCO meter number |
| `DISCORD_WEBHOOK_URL` | channel | - | Discord channel webhook (one of the two channels) |
| `EMAIL_TO` | channel | - | Email recipient (needs the full SMTP set) |
| `EMAIL_FROM` | channel | - | Email sender |
| `SMTP_HOST` | channel | - | SMTP server hostname |
| `SMTP_USER` | channel | - | SMTP username |
| `SMTP_PASS` | channel | - | SMTP password |
| `SMTP_PORT` | ❌ | 587 | SMTP port |
| `LOW_THRESHOLD` | ❌ | 150 | Warning threshold (BDT) |
| `CRITICAL_THRESHOLD` | ❌ | 100 | Critical threshold (BDT) |
| `ALERT_TONE` | ❌ | savage | Roast intensity: `savage` or `mild` |

This table covers self-hosted single-user mode only. Running the hosted server
(Telegram bot, web app, Postgres) takes a different set of variables - see
`.env.example` and [docs/DEPLOY.md](docs/DEPLOY.md).

## Development

### Build

```bash
bun run build
```

### Run Tests

```bash
bun run test
```

### Run Locally (mock mode, no bot token needed)

```bash
docker compose up -d   # Postgres + Mockoon (fake Telegram & DESCO APIs)
bun run db:migrate     # first time only
bun run dev
```

With the mock-mode block enabled in `.env` (see `.env.example`), the bot and the poll loop
run against Mockoon's fake Telegram and DESCO - no real token, nothing external contacted.
Add a meter on the dashboard at `/app` and the fake ৳42.50 balance trips a critical alert
on the next cycle. The mock fixture still scripts a `/register` message, but that command
only points at the dashboard now, so the meter has to come from there.

### End-to-End Test

```bash
bash scripts/e2e.sh
```

Spins up the production image, a throwaway Postgres, and [Mockoon](https://mockoon.com)
faking both the Telegram and DESCO APIs, then seeds an account and meter and asserts the
alert lands. It checks what the unit suites can't: that the image boots read-only with all
capabilities dropped, `/health` answers 200, `/admin` is a 404 while `ADMIN_PASSWORD` is
unset, and the fake ৳42.50 balance trips the critical threshold all the way through to a
delivered alert. It tears its own stack down when it finishes.

Bringing the compose file up by hand only boots the stack - onboarding lives on the web
dashboard now, so with an empty database there is nothing to poll and no alert ever fires.

### Lint & Format

```bash
bun run lint     # ESLint with type-aware rules
bun run format   # Prettier
```

Both run in CI on every push and PR, so run them before pushing.

## Tech Stack

- **TypeScript** - Type-safe balance checking
- **bun** - Package management & script running
- **undici** - HTTP requests (native fetch, no extra client)
- **nodemailer** - Email notifications
- **grammy** - Telegram bot (hosted mode)
- **Drizzle ORM + PostgreSQL** - Persistence (hosted mode)
- **GitHub Actions** - Automated scheduling
- **Jest** - Testing

## License

MIT - Use it, modify it, roast yourself with it.

## Disclaimer

This is just a personal project. You're using the DESCO API at your own risk. Also the emails are intentionally meant to roast you hard - set `ALERT_TONE=mild` if you can't handle it, or edit the copy in `src/notifications/`.

## Security Notes

- Never commit your `.env` file (it's in `.gitignore`)
- Use GitHub Secrets for CI/CD, never hardcode credentials
- TLS verification on DESCO's API is on by default. Their certificate chain has been flaky in the past, so if real calls start failing with cert errors you can set `DESCO_TLS_INSECURE=1` to skip it. The bypass is scoped to the DESCO client only, so everything else still verifies.
