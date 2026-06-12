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
