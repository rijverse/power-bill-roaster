#!/usr/bin/env bash
# Mocked end-to-end test: spins up app + throwaway Postgres + Mockoon (fake
# Telegram & DESCO), then asserts a watched meter produces a delivered alert.
# Run locally or in CI: bash scripts/e2e.sh
#
# The account and meter are seeded straight into Postgres. They used to come from
# a scripted Telegram /register conversation, but meters are created on the web
# dashboard now and that path needs a configured mailer (magic-link sign-in), which
# this stack deliberately does not have. Onboarding itself is covered by the unit
# and integration suites; what this proves is the part they cannot: that the real
# prod image, read-only and with all capabilities dropped, boots and carries a
# reading through poll -> alert -> delivery.
set -euo pipefail

dc="docker compose -p power-roast-e2e -f docker-compose.test.yml"

cleanup() { $dc down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Building and starting the e2e stack..."
$dc up -d --build

echo "Waiting for app to be healthy..."
for i in $(seq 1 30); do
  health=$($dc exec -T app node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" 2>/dev/null && echo ok || echo "")
  if [ "$health" = "ok" ]; then
    echo "e2e OK: /health returns 200 under read-only + cap-dropped container"
    break
  fi
  sleep 2
done
if [ "$health" != "ok" ]; then
  echo "e2e FAILED: app never became healthy. App logs:"
  $dc logs app
  exit 1
fi

echo "Checking /admin is a 404 without ADMIN_PASSWORD (hard-disable default)..."
admin_status=$($dc exec -T app node -e "fetch('http://127.0.0.1:3000/admin').then(r=>process.stdout.write(String(r.status))).catch(()=>process.stdout.write('err'))" 2>/dev/null || echo "")
if [ "$admin_status" != "404" ]; then
  echo "e2e FAILED: /admin returned ${admin_status:-nothing} (expected 404). App logs:"
  $dc logs app
  exit 1
fi
echo "e2e OK: /admin is a 404 (ADMIN_PASSWORD unset = panel disabled)"

# Seed the watched meter: chat id 1111 matches the Telegram chat the Mockoon
# updates come from, so the alert has somewhere to go, and the account/meter
# numbers match the mocked DESCO getBalance (which answers with a balance under
# the critical threshold). The identity row goes in alongside the legacy column,
# the same pairing linkIdentity keeps in the app.
echo "Seeding an account + meter to watch..."
$dc exec -T postgres-test psql -U powerroast -d powerroast -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO users (telegram_chat_id, plan) VALUES (1111, 'free')
  ON CONFLICT (telegram_chat_id) DO NOTHING;
INSERT INTO identities (user_id, provider, provider_uid, verified)
  SELECT id, 'telegram', '1111', true FROM users WHERE telegram_chat_id = 1111
  ON CONFLICT DO NOTHING;
INSERT INTO meters (user_id, provider, account_no, meter_no, low_threshold, critical_threshold, active)
  SELECT id, 'desco', '12345678', '87654321', 150, 100, true FROM users WHERE telegram_chat_id = 1111
  ON CONFLICT DO NOTHING;
SQL
seeded=$($dc exec -T postgres-test psql -U powerroast -d powerroast -tAc \
  "SELECT count(*) FROM meters WHERE active" 2>/dev/null || echo 0)
if [ "${seeded:-0}" -lt 1 ]; then
  echo "e2e FAILED: could not seed a meter, so no alert could ever fire."
  exit 1
fi
echo "e2e OK: ${seeded} meter(s) seeded and active"

echo "Waiting for a delivered alert (max 150s)..."
for i in $(seq 1 75); do
  count=$($dc exec -T postgres-test psql -U powerroast -d powerroast -tAc \
    "SELECT count(*) FROM alerts_log WHERE delivery_status='sent'" 2>/dev/null || echo 0)
  if [ "${count:-0}" -ge 1 ]; then
    echo "e2e OK: poll + alert + delivery pipeline delivered ${count} alert(s)"
    exit 0
  fi
  sleep 2
done

echo "e2e FAILED: no alert was delivered. App logs:"
$dc logs app
exit 1
