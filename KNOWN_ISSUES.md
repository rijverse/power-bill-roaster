# Known Issues / Post-Launch Cleanup

Status as of 2026-07-11, after the pre-launch review of `feat/free-only-launch`.
All **correctness bugs** found in that review were fixed on this branch (the
quiet-hours deferral in the outbox worker, the `SameSite=Lax` session cookie,
the transactional outbox claim, `eraseUser` payments handling, and friends).
The migration history was squashed to a single `0000_init` before first deploy
- from now on, never edit an applied migration; always add a new file (see
`src/__tests__/db/migrations.test.ts`). What remains below is
**maintainability, efficiency, and hardening debt** — none of it should block
going live, but each item gets more expensive to fix the longer it ages.

Ordered roughly by how likely each is to cause a real bug next.

---

## 1. Alert copy is authored 4 times and has already drifted

**Where:** `src/notifications/telegram-templates.ts`, `discord-templates.ts`,
`email-templates.ts`, `sms-templates.ts` — plus the legacy
`src/templates/critical.ts` / `warning.ts` still used by `src/cli.ts`.

- The savage critical title is `💀 EMERGENCY: Stone Age Imminent` on
  Telegram/Discord but `💀 EMERGENCY: You're About to Live in the Stone Age`
  in email — the drift this duplication invites has already shipped once
  (commit `a28b2be` fixed punctuation drift the same way).
- The CLI email path (`cli.ts` → `templates/`) ignores `tone_pref` entirely:
  a user who chose "mild" still gets the savage voice from CLI runs.
- `DEFAULT_RECHARGE_URL` is defined in 4 places even though `config.ts`
  already resolves it.
- `core/tone.ts` maps any unknown tone to `savage` — adding a third tone means
  editing every `tone === 'mild' ? A : B` ternary in 4 files, and a missed one
  silently roasts a user who opted out.

**Fix shape:** one copy module (action × tone → title/body/short-text) that
each channel renderer formats; delete `templates/critical.ts`/`warning.ts` and
point the CLI at the shared renderer.

## 2. The dispatcher fan-out is the same ~50 lines three times

**Where:** `src/notifications/dispatcher.ts` — `sendEmailAlert`,
`sendDiscordAlert`, `sendDiscordDmAlert` (and most of `sendSmsAlert`).

Each repeats: select enabled+verified channels of type X → loop → skip
`alreadyDelivered` key → send → `logDelivery` → collect delivered/failed keys.
Channel #6 means pasting a fourth copy, and forgetting the `alreadyDelivered`
check in the copy reintroduces duplicate sends on outbox retry — the exact bug
class the ledger exists to prevent.

**Fix shape:** a private `fanOutToChannels(type, keyPrefix, send)` helper; the
per-channel methods shrink to a render + send lambda. The existing
`dispatcher-*.test.ts` suites already pin the behavior, so this is a safe
refactor.

## 3. Security-critical HMAC/session code exists in three copies

**Where:** `src/web/token.ts`, `src/web/admin-session.ts`,
`src/web/user-auth.ts`.

`hmac`, `safeEqual`, sign/unsign, `csrfFor`/`verifyCsrf`, and the cookie
builders are near-identical clones (`userCookie` vs `sessionCookie` differ only
in constants). A hardening fix applied to one file silently misses the other
two — these already drifted once (SameSite). `user-auth.ts` also repeats its
`userId\nexpiry` parse block three times.

**Fix shape:** one `web/signed-token.ts` with namespaced sign/verify + a
parameterized cookie builder; the three modules keep only their namespaces and
TTLs.

## 4. HTTP handler plumbing duplicated; CSRF check pasted per-route in admin

**Where:** `src/web/server.ts`, `src/web/admin.ts`, `src/web/app.ts`.

- `readBody`/`json`/`redirect`/`clientIp`/`trustProxy` are copied into all
  three, and the copies already disagree: server caps bodies at 64 KiB,
  admin/app at 16 KiB. `clientIp` + `TRUST_PROXY` is a spoofing decision that
  keys the rate limiters — it must not live in two places.
- `admin.ts` pastes the CSRF header check into four route branches
  (~lines 828/847/894/939) while `app.ts` checks once for every POST at a
  choke point. The next admin mutation route added without the paste ships
  CSRF-unprotected, and nothing would catch it.

**Fix shape:** extract `web/http-utils.ts`; in `handleAdminRequest`, hoist one
CSRF check for all mutating methods the way `app.ts` does.

## 5. Hot-path query waste (fine at launch scale, not at growth scale)

**Where:** `src/core/scheduler.ts`, `src/core/alert-dispatcher.ts`,
`src/notifications/dispatcher.ts`.

- Scheduler does a per-meter `alert_state` SELECT inside the poll loop (N+1);
  the initial meters+users join could LEFT JOIN it.
- The outbox worker re-fetches user and meter as two sequential single-row
  SELECTs per row; `drainBatch` could join them.
- Each dispatch issues one channels SELECT per type (4–5 per alert); one
  `WHERE user_id = ?` select filtered in memory would do.

At ~7 queries per alert on a remote Postgres this only bites during alert
storms — which is exactly when throughput matters.

## 6. The Discord bot re-implements the Telegram bot's command surface

**Where:** `src/discord/bot.ts` vs `src/bot/index.ts` (and partly
`src/web/app.ts`).

Only register/threshold/nickname went through `core/meter-usecases.ts`;
`handleStop`/`handleDelete`/`handleTone`/`handlePlan`/`handleBalance` are
parallel re-implementations, `billingLive` is computed independently in both
bots, and the Discord-webhook connect flow (validate → test embed → upsert
verified channel) exists three times (`bot/index.ts` ~753, `discord/bot.ts`
~477, `web/app.ts` ~362). Policy changes (delete confirmation, stop semantics)
must now be made 2–3 times and will drift. The prediction block (7-day
readings → `predictRunOut`) is also copied in three files with its own
`PREDICTION_WINDOW_MS` each.

**Fix shape:** finish the `meter-usecases.ts` migration for the remaining
commands; add `connectDiscordWebhook()` to core; move the prediction block
into a core helper.

## 7. Erase/merge are hand-maintained table checklists (no cascades)

**Where:** `src/core/erase-user.ts`, `src/core/merge-accounts.ts`,
`src/db/schema.ts` (7 FKs, zero `ON DELETE` rules).

Every new user- or meter-FK table must be remembered in **both** functions by
hand; history shows it gets forgotten (`pending_alerts` in `0ea6187`,
`payments` fixed in this pass, Discord identity in `af247df`). The loser row is
deleted before the survivor is stamped, so a forgotten identity column vanishes
with no FK error to catch it.

**Fix shape:** either `ON DELETE CASCADE` on the child tables (one migration,
deletes shrink to `DELETE FROM users`) or a single registry of user-owned
tables both functions iterate. Also consider a test that reflects over
`schema.ts` FKs and asserts each is covered by `eraseUser`.

## 8. Operator alarms and dead-letter pings are still Telegram-only

**Where:** `src/core/scheduler.ts` `alarmOperator`,
`src/core/alert-dispatcher.ts` (`adminSender.sendTelegram`).

The *user*-facing failure notice now falls back to Discord DM (fixed this
pass), but operator alarms still assume the operator has Telegram configured
(`adminChatId`). Fine for the current single operator; wrong the day the bot
runs Discord-only.

## 9. `unhandledRejection` only logs

**Where:** `src/index.ts` ~148.

Deliberate and commented, but it trades Node's fail-fast (+ Docker restart)
for a half-dead process if a floating promise wedges shared state. The
backstop is the `/health` staleness check (up to 2× poll interval ≈ 12 h) —
and only if an uptime monitor is actually watching `/health`. **Action:** wire
an uptime monitor before/at launch; consider exiting on rejections from known
critical paths.

## 10. DB TLS boot guard can crash-loop an unedited legacy `.env`

**Where:** `src/db/index.ts` ~41.

A pre-existing deploy whose `DATABASE_URL` points at a remote/compose-hostname
Postgres without `sslmode` now refuses to boot (clear error message, and
`docs/DEPLOY.md` documents the fix). Acceptable hardening — just be aware the
first deploy after upgrade may need an `.env` touch-up.

## 11. Small leftovers

- `src/logger.ts` `child()` is a documented no-op with zero callers — a future
  caller will expect request-id bindings and silently get none. Delete it or
  implement it.
- `src/web/admin-html.ts` `parseHashClient` still hand-mirrors
  `admin-hash.ts#parseHash` (the unsafe decode was fixed this pass). The
  codebase already ships shared client code as JS strings
  (`theme.ts` `CLIENT_HELPERS`) — the canonical parser could ride the same
  mechanism.
- Jest prints “a worker process has failed to exit gracefully” after the full
  suite — a teardown leak in the web suites (HTTP servers/timers), pre-existing.
  `--detectOpenHandles` will point at it.
- The outbox claim lease is 10 minutes (`CLAIM_LEASE_MS`): if a crash happens
  mid-batch, unprocessed rows wait out the remainder of the lease before
  another worker picks them up. Tightening it requires bounding worst-case
  batch time (channel send timeouts) first.
