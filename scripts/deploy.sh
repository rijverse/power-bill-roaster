#!/usr/bin/env bash
# Roll out the latest image and verify /health before trusting it. If the new
# container never goes healthy, roll back to the image that was running before.
# Run on the server from the app directory (e.g. /opt/power-roast):
#   ./scripts/deploy.sh
# Assumes migrations are already applied (deploy.yml does that on push to main);
# migrations must be backward-compatible so the old image keeps working if we
# roll back. See docs/DEPLOY.md.
set -euo pipefail

compose="docker compose -f docker-compose.prod.yml"
health_url="${HEALTH_URL:-http://localhost:3000/health}"
repo="ghcr.io/${IMAGE_REPO:-rijverse/power-bill-roaster}"

# Remember the image currently serving traffic so we can fall back to it.
prev_image="$($compose images -q app 2>/dev/null || true)"

echo "Pulling latest image..."
$compose pull

echo "Starting new container..."
$compose up -d

echo "Waiting for ${health_url} to report healthy..."
for _ in $(seq 1 30); do
  if curl -fsS "$health_url" >/dev/null 2>&1; then
    echo "Deploy OK: ${health_url} is healthy."
    exit 0
  fi
  sleep 2
done

echo "Deploy FAILED: ${health_url} never went healthy. Recent logs:" >&2
$compose logs --tail 50 app >&2 || true

if [ -n "$prev_image" ]; then
  echo "Rolling back to the previous image (${prev_image})..." >&2
  docker tag "$prev_image" "$repo:rollback"
  IMAGE_TAG=rollback $compose up -d
  echo "Rolled back. Investigate the logs above before retrying." >&2
else
  echo "No previous image to roll back to - the container may be crash-looping." >&2
fi
exit 1
