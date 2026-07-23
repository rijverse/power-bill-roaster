#!/usr/bin/env bash
# Mocked end-to-end test: spins up app + throwaway Postgres + Mockoon (fake
# Telegram & DESCO), then asserts the scripted user's registration produced a
# delivered alert. Run locally or in CI: bash scripts/e2e.sh
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

echo "Waiting for a delivered alert (max 150s)..."
for i in $(seq 1 75); do
  count=$($dc exec -T postgres-test psql -U powerroast -d powerroast -tAc \
    "SELECT count(*) FROM alerts_log WHERE delivery_status='sent'" 2>/dev/null || echo 0)
  if [ "${count:-0}" -ge 1 ]; then
    echo "e2e OK: registration + poll + alert pipeline delivered ${count} alert(s)"
    exit 0
  fi
  sleep 2
done

echo "e2e FAILED: no alert was delivered. App logs:"
$dc logs app
exit 1
