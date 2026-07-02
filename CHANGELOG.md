# Changelog

Notable changes to Power Roast. This project follows [semantic versioning](https://semver.org).

## [1.0.0] - 2026-07-02

First public release, a free-only launch. Paid plans are implemented but ship
disabled behind a flag, so a fresh deploy can't sell or grant a plan by accident.

### Two ways to run

- **Self-hosted (free)**: fork the repo, add your DESCO and SMTP secrets, and a
  scheduled GitHub Actions workflow checks your prepaid balance daily and emails
  you when it's low. No server.
- **Hosted (Telegram bot)**: a bot plus scheduler with run-out predictions, a web
  dashboard of balance-history charts, multi-meter support, an operator admin
  panel at `/admin`, a customer web app at `/app` with passwordless email sign-in,
  and email/SMS alert channels.

### Billing

- `BILLING_PROVIDER` defaults to `none`: `/upgrade` replies "coming soon" and no
  money or plan change happens. bKash and SSLCommerz gateways are wired up behind
  the flag for a later paid launch. Payments are re-verified server-side (never
  trusting the callback body) and recorded in an idempotent ledger, so duplicate
  IPNs are harmless.

### Operations

- Dockerized hosted deployment. `deploy.yml` migrates the production DB, then
  builds and pushes the image to GHCR tagged `:latest` and `:<commit-sha>`; pin
  `IMAGE_TAG` to a sha to roll back.
- `/health` endpoint reports 503 on a wedged poll cycle, an unreachable database,
  or cold start.
- Single poll cycle is multi-instance-safe (Postgres advisory lock) and alerts go
  out through an outbox worker (`FOR UPDATE SKIP LOCKED`), so nothing double-sends.
- DESCO upstream TLS is verified by default; `DESCO_TLS_INSECURE=1` scopes a
  bypass to that one client if their certificate chain breaks.
