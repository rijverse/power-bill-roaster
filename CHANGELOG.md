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

### Security

- CSP no longer allows `'unsafe-inline'` scripts: every inline `<script>`
  carries a per-request nonce instead (the admin login's password toggle moved
  off an `onclick` attribute for the same reason). Styles keep
  `'unsafe-inline'` - the pages lean on `style=""` attributes, which nonces
  can't cover.

### Fixed

- The customer dashboard shows missing balances as unknown and labels partial
  totals as "Known balance". A meter with no recent reading no longer makes the
  dashboard claim every meter is healthy or show a zero total.
- `eraseUser` was dying with a FK violation on `pending_alerts` for any user
  who ever had an alert queued. Outbox rows were never being cleared.
  Erasure now clears them (by meter and by user, both blocks).
- A poll cycle that failed before the meter loop (e.g. a DB blip on the meters
  join) surfaced only as an unhandled-rejection log. `runOnce` now catches and
  logs it as a cycle failure; the watchdog remains the restart backstop.
- Outbox rows that repeatedly hang (row timeout) now count those attempts and
  dead-letter at the usual cap instead of retrying forever off the expiring
  claim lease. Rows with an unrecognized action/level (hand-inserted, corrupt)
  are failed instead of dispatched on a blind cast.
- Plan-change notices (payment confirmed, plan expired) now fall back to a
  Discord DM for users without Telegram; they were silently skipped before.
- The SMS monthly budget window now rolls at midnight Dhaka rather than
  server-local midnight, and quiet-hours/budget code share one fixed-offset
  Dhaka clock instead of two mechanisms.
- Adding a meter kept the balance it had just fetched. It was read to validate
  the numbers and then discarded, so with the default six-hour poll interval a
  new account's dashboard showed ৳0.00 and "every meter is healthy" for the
  rest of the day, and the first alert waited that long too. Every surface that
  reads a balance now goes through one `recordReading` path (poll cycle, add a
  meter, force check, operator re-check), which writes the reading, the
  alert_state snapshot, and the outbox row together.
- "Force check" on the dashboard now re-reads the meters from the provider. It
  only re-rendered what was already in the database, so between poll cycles it
  did nothing visible.
- A paused meter is visible and resumable from the dashboard. Pausing removed
  it from the payload entirely, so the screen read "no meters yet" and the only
  way back was to retype the account and meter numbers. Resuming counts against
  the plan cap.
- The sign-in screen opens on Email, the only path that creates an account.
  It opened on Telegram, and the bots stopped creating accounts when onboarding
  moved to the web, so the bot could only point people back at the sign-in page.
  The "enter the code" form is also prefilled from the address just used
  (short-lived `pr_email` cookie, not the query string).
- The tone preview on the Alerts screen renders the real critical-alert copy via
  `alertPreview`, and follows the threshold sliders. It was a second hardcoded
  copy of the wording and no longer matched the email being sent.
- Removed the "Switch to admin" link from every customer's sidebar. It was
  unconditional and led to a page announcing that it holds customer PII.
- Deleting an account confirms it happened (`/app?status=deleted`) instead of
  dropping the user on a "welcome back" sign-in screen, and asks through the
  shared styled modal rather than a native `prompt()` (which some mobile
  browsers suppress outright).
- Landing-page pricing comes from `core/plans.ts`. It advertised "Roast Pro
  ৳99" and "Power User ৳249"; the app sells Plus ৳40 and Business ৳250. Its
  hero and closing calls to action no longer promise a bot chat for a link that
  opens an email sign-in, and the nav no longer overflows sideways below 460px.
- Stale `/register` instructions replaced with the dashboard everywhere they
  survived: the token dashboard's empty state, the `/stop` confirmation, the
  "can't read your meter" notice, and the plan-expiry notice (which also
  offered `/upgrade` during a free-only launch).
- Every page carries an inline favicon; each page load used to 404 on
  `/favicon.ico`.
- User-facing counts read "1 meter" instead of "1 meter(s)".

### Admin console fixes

- The operator's reason is recorded for pause, resume, revoke, and erase, not
  just grant. The audit row deliberately still identifies the customer by id
  only: it outlives the account, so it must not carry their address.
- Erasing a customer asks the operator to type that customer's email. It asked
  for the word "ERASE", which is identical in every tab and cannot catch
  erasing the wrong person.
- A single month of revenue renders as one figure instead of a full-width
  "trend" drawn from one data point with the same month at both ends.
- The customer detail shows the normalized tone (Savage/Mild) rather than the
  raw `roast` column value.
- `prModal` moved to `theme.ts` so both consoles share one confirm dialog.

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
