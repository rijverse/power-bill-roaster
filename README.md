# Power-Roast

A TypeScript-based DESCO prepaid electricity balance monitor that sends brutally honest email notifications when your balance gets dangerously low. Because sometimes you need tough love to remember to recharge.

## What It Does

It checks your DESCO prepaid meter balance and fires off angry emails if you're getting close to zero 

- **Below 150 BDT** (configurable) Warning shot  "Your Electricity About to Ghost You"
- **Below 100 BDT** (configurable) DEFCON 1  "You're About to Live in the Stone Age"

## Two Ways to Run It

1. **Self-hosted (free forever) ** just fork this repo, toss your details into GitHub secrets, and the workflow does its thing on a schedule. Zero servers, zero cost. The setup guide below covers this.
2. **Hosted (Telegram bot) ** a bot that does it all for you  no fork, no secrets, just message the bot. Run-out predictions ("~3 days left at this rate"), a web dashboard with balance history charts, multi-meter support, and SMS alerts on paid plans (bKash / SSLCommerz billing). Deploy your own with [docs/DEPLOY.md](docs/DEPLOY.md).

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

Create a `.env` file in the project root:

```env
# Required
DESCO_ACCOUNT_NO=your_account_number
DESCO_METER_NO=your_meter_number
EMAIL_TO=recipient@example.com
EMAIL_FROM=sender@example.com
SMTP_HOST=smtp.gmail.com
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Optional
SMTP_PORT=587
LOW_THRESHOLD=150
CRITICAL_THRESHOLD=100
```

### 3. Set Up GitHub Secrets

To make this run automatically via GitHub Actions, just drop these secrets into your repo 

1. Go to your repo's **Settings** → **Secrets and variables** → **Actions**
2. Add the following secrets

**Required **
- `DESCO_ACCOUNT_NO`
- `DESCO_METER_NO`
- `EMAIL_TO`
- `EMAIL_FROM`
- `SMTP_HOST`
- `SMTP_USER`
- `SMTP_PASS`

**Optional **
- `SMTP_PORT` (defaults to 587)
- `LOW_THRESHOLD` (defaults to 150)
- `CRITICAL_THRESHOLD` (defaults to 100)

## Usage

### Run Manually

```bash
bun run check-balance
```

### Automated Checks

The GitHub Actions workflow kicks in every 6 hours on its own. You can also force it to run manually from the **Actions** tab if you're impatient.

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
5. Blasts out a wildly aggressive email if you're too low
6. Logs everything for your viewing pleasure

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DESCO_ACCOUNT_NO` | ✅ | - | Your DESCO account number |
| `DESCO_METER_NO` | ✅ | - | Your DESCO meter number |
| `EMAIL_TO` | ✅ | - | Email recipient |
| `EMAIL_FROM` | ✅ | - | Email sender |
| `SMTP_HOST` | ✅ | - | SMTP server hostname |
| `SMTP_USER` | ✅ | - | SMTP username |
| `SMTP_PASS` | ✅ | - | SMTP password |
| `SMTP_PORT` | ❌ | 587 | SMTP port |
| `LOW_THRESHOLD` | ❌ | 150 | Warning threshold (BDT) |
| `CRITICAL_THRESHOLD` | ❌ | 100 | Critical threshold (BDT) |

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

With the mock-mode block enabled in `.env` (see `.env.example`), a scripted mock user
registers a meter and the fake ৳42.50 balance trips a critical alert within a minute -
the whole pipeline runs without a Telegram token or touching DESCO.

### End-to-End Test

```bash
docker compose -f docker-compose.test.yml up --build
```

Spins up the app, a throwaway Postgres, and [Mockoon](https://mockoon.com) faking both the
Telegram and DESCO APIs. A scripted mock user registers a meter, the fake balance (৳42.50)
trips the critical threshold, and the alert fires - watch the app logs. Clean up with
`docker compose -f docker-compose.test.yml down -v`.

### Lint & Format

```bash
bun run lint     # ESLint with type-aware rules
bun run format   # Prettier
```

Both run in CI on every push and PR, so run them before pushing.

## Tech Stack

- **TypeScript** - Type-safe balance checking
- **bun** - Package management & script running
- **node-fetch** - API requests
- **nodemailer** - Email notifications
- **GitHub Actions** - Automated scheduling
- **Jest** - Testing

## License

MIT - Use it, modify it, roast yourself with it.

## Disclaimer

This is just a personal project. You're using the DESCO API at your own risk. Also the emails are intentionally meant to roast you hard  feel free to tone them down in `src/templates/` if you can't handle it.

## Security Notes

- Never commit your `.env` file (it's in `.gitignore`)
- Use GitHub Secrets for CI/CD, never hardcode credentials
- We actually disable SSL verification for DESCO's API because their certificates act up sometimes  just keeping you in the loop on that.
