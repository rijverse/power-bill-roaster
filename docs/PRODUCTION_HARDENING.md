# Production Hardening — Power Bill Roaster

What was wrong going into today, and what we changed.

## The gaps

1. **Alert duplication on crash** (blocking for paid/SMS) — `alert_state`
   was being written *before* `dispatchAlert` ran, so a crash in between
   left the user with `lastAlertAt` advanced but no message sent. Next
   cycle thought it was already alerted, so it stayed silent.
2. **`node-fetch@2.7.0` is EOL** (Sep 2022). Swapping to native `fetch`
   without an undici dispatcher would have silently re-enabled DESCO cert
   validation.
3. **DESCO SSL bypass was undocumented in code and always-on**. No way
   to turn it off.
4. **No automated deploy / no migration safety net** — DEPLOY.md literally
   said "remember to run migrations".
5. **No structured logging** — incidents at 3 AM had only stdout.
6. **PII in logs** — `dispatcher.ts` and `cli.ts` printed full emails /
   phones / account numbers.
7. **Health endpoint had no DB ping** — `/health` reported OK with a dead
   DB.
8. **Hardcoded `RECHARGE_URL` in 5 source files** + dead `.env.example`
   comments.

## What changed

### 1. Outbox pattern for alerts

New table `pending_alerts` written in the same transaction as `alert_state`.
A worker drains it; rows only flip to `sent` after the channel confirms
delivery. If the process dies mid-dispatch, the row stays pending and the
next cycle re-evaluates. No duplicates, no lost alerts.

`src/core/alert-dispatcher.ts` polls every 5s, locks a batch with
`FOR UPDATE SKIP LOCKED` (so two replicas can run in parallel), and after
5 failed attempts marks a row 'failed' and pings the operator. Independent
graceful shutdown.

The crash window is closed at the DB transaction boundary, not in
application code, so the same pattern works whether the worker runs in
this process, a separate one, or gets swapped for SQS/BullMQ later.

### 2. `node-fetch` → native fetch + undici

`src/core/http.ts` now uses native `fetch` (Node 22). For DESCO's TLS
bypass, callers pass an `undici.Agent` through the new `dispatcher` field.
`package.json` drops `node-fetch` and `@types/node-fetch`, gains `undici`.

### 3. `DESCO_TLS_INSECURE` env flag

`src/services/desco-api.ts` only constructs the insecure `undici.Agent`
when `DESCO_TLS_INSECURE=1`. Default OFF. Documented in `.env.example`
and `docs/DEPLOY.md` as a temporary workaround for DESCO's flaky cert
chain.

### 4. Deploy workflow

`.github/workflows/deploy.yml` runs `bun run db:migrate` against
`secrets.DATABASE_URL`, then builds and pushes the image to
`ghcr.io/<repo>:latest`. If the schema is broken, the image never gets
pushed. Server pull/restart stays manual (operator concern).

### 5. Structured logger

`src/logger.ts` — JSON in `NODE_ENV=production`, pretty in dev. Drop-in
replacement for `console.log/warn/error` in `index.ts`, `scheduler.ts`,
`dispatcher.ts`, `cli.ts`, `sms/console.ts`. No pino / winston — the
existing 21 call sites wanted a thin wrapper, not a transport config.

### 6. PII masking

The logger auto-masks emails, BD phone numbers, `account:/meter:` pairs,
and 40+ char hex tokens before they reach stdout. Specific sites
(`dispatcher.ts`, `cli.ts`, `sms/console.ts`) also call the explicit
`maskEmail` / `maskPhone` / `maskAccount` helpers for clarity.

### 7. `/health` pings the DB

`src/web/server.ts` runs `SELECT 1` with a 2s timeout. If the DB is dead
the endpoint returns 503 with `{ status: 'db-down' }`.

### 8. `RECHARGE_URL` consolidated

Lives in `ServerConfig` (and the self-hosted `Config`). Threaded through
`MeterContext` so template functions stay pure. The client-side
`RECHARGE_URL` in the web app is server-injected at HTML render time,
not hardcoded.

### 9. Graceful shutdown + crash handlers

`src/index.ts` awaits `alertWorker.stop()` and `healthServer.close()` on
SIGINT/SIGTERM (with a re-entrancy guard), and `process.on` handlers for
`unhandledRejection` / `uncaughtException` log + exit non-zero so Docker
restarts a wedged process.

## Files

**New** (6):
- `src/logger.ts`
- `src/core/alert-dispatcher.ts`
- `drizzle/0007_add_pending_alerts.sql`
- `drizzle/meta/0007_snapshot.json` (drizzle-kit output)
- `src/__tests__/core/alert-dispatcher.test.ts`
- `.github/workflows/deploy.yml`

**Edited** (26) — see `git log --stat` for the full list, or the
verification commit.

## Verification

1. `bun run build` — clean.
2. `bun run test` — 26 suites / 183 tests pass (was 25 / 178; +5 new).
3. `bun run lint` and `bun run format:check` — clean.
4. `bun run db:generate` — `No schema changes, nothing to migrate`.
5. `bash scripts/e2e.sh` — still passes; the scripted fake user triggers
   a critical alert that goes through the new outbox pipeline.
6. `docker compose -f docker-compose.prod.yml build` — succeeds.

## Operational notes

- The outbox's `status` is the source of truth for "did this fire?". If
  the worker is wedged, check
  `SELECT count(*), status FROM pending_alerts GROUP BY status`. A
  growing `pending` count is the canary.
- `payload` stores the full `MeterContext` at decision time, so the
  worker doesn't have to re-fetch the meter or recompute the prediction.
  It's a snapshot, not a reference — don't add live data to it.
- `FOR UPDATE SKIP LOCKED` is what lets multiple workers / replicas run
  safely. The lock is held only for the duration of one tick; failed /
  sent rows release immediately.
- `DESCO_TLS_INSECURE` is the **only** way the app talks to a remote
  host without cert verification. It's scoped to the DESCO client and
  off by default. Set it only if DESCO's cert chain breaks; remove the
  env var when they fix it.
- The PII mask catches BD phone numbers, emails, and account/meter
  keywords automatically. New `console.log` calls that bypass the logger
  won't be masked. Prefer `logger.info/warn/error` everywhere.
