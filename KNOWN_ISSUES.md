# Known Issues / Accepted Trade-offs

Status as of 2026-07-11. The post-launch cleanup that this file used to track is
done: all eleven items from the pre-launch review of `feat/free-only-launch` are
closed. Git history is the record of _how_; what's left here is what a reader
still needs to know — what is deliberately still open, what was decided against,
and the invariants the tests now hold in place so they don't rot again.

Two ground rules that bit us before and still apply:

- **Never edit an applied migration.** History was squashed to a single
  `0000_init` before first deploy; always add a new file
  (`src/__tests__/db/migrations.test.ts` guards this).
- **Never re-fork the code the tests below pin.** Each one exists because
  something already drifted once.

---

## Still open

### The uptime monitor is external and unconfigured

`/health` reports `ok` / `stale` / `db-down`, the Dockerfile has a `HEALTHCHECK`
against it, and the process now runs its own watchdog that exits when the poll
loop goes stale (`restart: unless-stopped` acts on **exit**, not on unhealthy, so
a healthcheck alone would restart nothing). None of that is a substitute for an
external monitor: if the container is down, nothing inside it can tell you.
**Point an uptime monitor at `/health`** — see `docs/DEPLOY.md`.

### The web test suites flake under parallel load (~1 run in 16)

A web suite occasionally fails a `fetch` with a transport error (`bad port`,
`fetch failed`) during a full `bun run test`. It is **not** an assertion failure —
no test has ever failed on its logic — and it does not reproduce in isolation
(the same suite passes 12/12 alone, and the same open/fetch/close pattern runs
400/400 clean outside Jest). It predates this cleanup: the first one showed up
before the test harness was touched at all.

Mitigated, not cured. `__tests__/helpers/setup-fetch.ts` stops undici pooling a
keep-alive socket per ephemeral test port, which cut it from roughly 1 run in 4
to 1 in 16 and fixed the "worker failed to exit gracefully" warning outright. The
remaining suspect is ephemeral-port churn on Windows (~500 short-lived servers per
run). The real fix is for the suites to stop standing up a fresh HTTP server per
test; `__tests__/helpers/http-server.ts` is the place to do it.

## Accepted, on purpose

- **`unhandledRejection` only logs.** One floating promise usually isn't grounds
  to tear the process down — a transient Telegram 429 shouldn't restart the app.
  The failure that _does_ matter (a rejection wedging the poll loop) is caught by
  the watchdog, which acts on the symptom rather than trying to classify the cause.
- **The SMS budget count is a 6th query per alert.** Channels collapsed to a single
  `WHERE user_id = ?`, but the monthly budget is an aggregate over `alerts_log` and
  can't be joined away. It only runs on plans that actually have an SMS budget.
- **`/delete` is implemented three times.** The confirm flows are genuinely
  different UX (Telegram's 60s pending map, Discord's `confirm:CONFIRM` option, the
  web modal) and all three already call the shared `eraseUser`. Only the policy
  wording is shared. A shared state machine over three different confirmation
  affordances would be worse than what's there.
- **The landing page's roast copy is not wired to `alert-copy.ts`.** It's
  marketing, and it shouldn't silently rewrite itself when alert tone is tuned
  (`web/home-html.ts`).
- **Dashboard links keep an unnamespaced `userId.expiry` payload.** It's a live
  wire format; changing it invalidates every link already in the wild
  (`web/token.ts`).
- **The user cookie is `SameSite=Lax`, the admin cookie is `Strict`.** Not an
  oversight: the user cookie has to survive the cross-site magic-link redirect
  (`web/user-auth.ts`).
- **No `ON DELETE CASCADE`.** Considered and rejected for the erase/merge cleanup:
  cascade does nothing for `mergeAccounts` (which re-points FKs rather than deleting
  the parent), it would need the riskiest migration on the list for zero behavior
  change today, and it trades a loud FK error for silent data loss in exactly the
  tables backing the privacy policy's erasure promise. `db/ownership.ts` + the
  reflection test does the job with no migration at all.
- **A late-landing send after a timeout isn't cancelled.** `withTimeout` stops
  _waiting_, it doesn't abort the transport. That's fine: the row is retried, and
  the delivered-key ledger stops the same channel being sent twice.
- **`grammy` pulls `node-fetch@2.7.0` (EOL).** grammy's HTTP transport depends on
  node-fetch 2.x, which only receives critical fixes. No app code imports it
  directly. Track upstream; a grammy 3.x using native fetch is the eventual fix.
- **`/delete` retains an internal audit log.** `admin_audit` rows (operator
  actions: grant/pause/erase with a free-text reason) survive `/delete` by
  design - `target_user_id` is a plain column, not an FK, so erasure doesn't
  cascade. The `/privacy` text discloses this; it carries no balance or meter
  data.
- **`__Host-` cookie prefix only under HTTPS.** The prefix requires `Secure`,
  which can't be set over dev HTTP, so the cookie name is `__Host-pr_admin` in
  prod and `pr_admin` in dev (`adminCookieName(secure)`). The session is
  HMAC-signed regardless, so cookie injection from a subdomain can't forge a
  valid token.

## Invariants the tests now hold

Each of these pins something that had already drifted, or that the next refactor
would plausibly break. If one starts failing, read it before you "fix" it.

| Test                                        | What it stops                                                                                                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notifications/alert-copy.test.ts`          | Every channel renders the _same_ alert title. The critical title once read "Stone Age Imminent" on chat and "You're About to Live in the Stone Age" in email.                                                    |
| `notifications/dispatcher-telegram.test.ts` | Telegram delivers to an **unverified** channel row. Talking to the bot _is_ the verification — routing it through a shared "enabled + verified" helper would mute every Telegram user.                           |
| `notifications/dispatcher-sms.test.ts`      | The monthly SMS budget is a hard cap. It's the only channel that costs money, and it's the one a shared fan-out helper would silently overspend.                                                                 |
| `notifications/dispatcher-channels.test.ts` | Exactly **one** channels query per alert (was five).                                                                                                                                                             |
| `notifications/dispatcher-timeout.test.ts`  | A hung channel send is failed, not waited on.                                                                                                                                                                    |
| `core/alert-dispatcher.test.ts`             | A hung row can't wedge the outbox (`tick()` skips while one is in flight, so an unbounded row used to stop _all_ delivery); user/meter lookups stay O(1) per batch.                                              |
| `web/signed-token.test.ts`                  | A token minted for one purpose can never verify as another (4×4 namespace matrix).                                                                                                                               |
| `web/admin-csrf.test.ts`                    | Every mutating admin route 403s without a CSRF token — including ones added later.                                                                                                                               |
| `web/admin-hash.test.ts`                    | The client parser shipped to the browser agrees with the server parser, input for input.                                                                                                                         |
| `db/ownership.test.ts`                      | A new table that FKs `users`/`meters` can't be forgotten by `eraseUser`/`mergeAccounts`. Also pins the `users` column set: reflection can't tell you a new identity column needs handling in `mergedIdentity()`. |
| `db/migrations.test.ts`                     | An applied migration is never edited.                                                                                                                                                                            |
| `scripts/check-additive-migrations.test.ts` | A non-additive migration (DROP/ALTER/RENAME) fails CI before prod.                                                                                                                                               |
| `web/health.test.ts`                        | `/health` actually goes red when the DB is down or the poll loop stops.                                                                                                                                          |
| `web/security-headers.test.ts`              | The CSP pins the exact Chart.js bundle, not the whole jsdelivr CDN.                                                                                                                                              |
| `web/html-escaping.test.ts`                 | A crafted dashboard token can't break out of the script context (`</script>` escaped).                                                                                                                           |
| `no-console.test.ts`                        | Production source uses the PII-masking logger, never `console.*` directly.                                                                                                                                       |
| `billing/subscriptions.test.ts`             | `expireOverdue` rolls back all three writes if the meter cap throws (no half-applied downgrade).                                                                                                                 |
| `cli.test.ts`                               | The CLI exits 1 only on total channel wipeout, and its threshold classify order is pinned.                                                                                                                       |
