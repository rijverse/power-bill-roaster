# Changelog

Notable changes to Power Roast. This project follows [semantic versioning](https://semver.org).

## [Unreleased]

### Discord bot

Same product as the Telegram bot, on Discord. Optional - set `DISCORD_APP_ID`,
`DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` and you get slash commands
(`/register`, `/balance`, `/threshold`, `/nickname`, `/tone`, `/webhook`,
`/plan`, `/dashboard`, `/meters`, `/stop`, `/delete`, `/privacy`, `/help`),
alerts as DMs, and ed25519 signature verification on the interactions
endpoint. Full setup in docs/DEPLOY.md.

A few bits worth calling out:

- The interactions endpoint (`POST /discord/interactions`) is the whole wiring -
  no gateway connection, no message-content access. Body is signature-checked
  with Node's crypto so no new deps.
- DM alerts ride the same outbox as every other channel (new `discord-dm`
  channel type, same retry/ledger semantics). Command replies are ephemeral by
  default so balances and dashboard tokens never sit in a public channel.
- `/register` immediately test-DMs the user. If the DM bounces (closed DMs),
  the confirmation says so and points at `/webhook` as the fallback. Less
  surprising than finding out at the first real alert.
- One account across web + Telegram + Discord: `/telegram` in the Discord bot
  hands out a signed deep link; opening it in Telegram stamps the Discord id
  onto the existing account (or merges two accounts, keeping meters, plan,
  and every alert channel). Same flow as web → Telegram. Merges now preserve
  the Discord identity too, so a Telegram + Discord user that connects to
  web doesn't lose either.
- Shared registration / threshold / apply-thresholds logic moved to
  `core/meter-usecases.ts` so the two bots can't drift apart.

### Admin

- Discord-bot users show up in the user list and detail; search by discord id;
  the delivery logs picker now has a Discord DM channel filter.
- Free-only launch: the admin home is "Ops & health" (usage stats + poll
  health + dead letters) instead of an all-zero revenue board.
- Native browser `confirm`/`prompt` were ugly and broke iframe embedding;
  swapped for styled in-panel modals (erase still wants the word `ERASE`).
- Delivery logs are now paginated. Webhook URLs in delivery rows are masked
  (the URL embeds the webhook token).
- Pause on a deleted user now 404s. Was silently logging a no-op audit row
  before.

### Fixed

- `eraseUser` was dying with a FK violation on `pending_alerts` for any user
  who ever had an alert queued. Outbox rows were never being cleared.
  Erasure now clears them (by meter and by user, both blocks).


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
