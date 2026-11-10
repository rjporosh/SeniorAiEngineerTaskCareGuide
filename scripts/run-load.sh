#!/usr/bin/env bash
# Runs the k6 suites against the local Docker stack.
#   scripts/run-load.sh [load|stress|spike|upload|ratelimit ...]     (default: ratelimit load spike upload stress)
# Rate limits are raised for the run (and restored afterwards) so the measurements reflect the service, not the limiter.
set -uo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env" >&2; exit 1; }
set -a; . ./.env; set +a
SUITES=("$@"); [ ${#SUITES[@]} -gt 0 ] || SUITES=(ratelimit load spike upload stress)
K6=grafana/k6:1.3.0
run_k6() { docker run --rm --add-host host.docker.internal:host-gateway -v "$PWD/tests/load:/scripts:ro" -e API_URL="http://host.docker.internal:${API_PUBLIC_PORT:-4000}/api/v1" -e ADMIN_EMAIL="$SEED_ADMIN_EMAIL" -e ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" "$K6" run "/scripts/$1.js"; }
rc=0
for s in "${SUITES[@]}"; do
  if [ "$s" = ratelimit ]; then sed -e 's/^LOGIN_RATE_LIMIT_PER_MINUTE=.*/LOGIN_RATE_LIMIT_PER_MINUTE=10/' .env > .env.load; else sed -e 's/^RATE_LIMIT_PER_MINUTE=.*/RATE_LIMIT_PER_MINUTE=1000000/' -e 's/^LOGIN_RATE_LIMIT_PER_MINUTE=.*/LOGIN_RATE_LIMIT_PER_MINUTE=1000/' .env > .env.load; fi
  ENV_FILE=.env.load docker compose up -d --force-recreate api >/dev/null 2>&1
  for _ in $(seq 1 40); do [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${API_PUBLIC_PORT:-4000}/api/v1/health/ready")" = 200 ] && break; sleep 2; done
  echo "=================== k6: $s ==================="
  run_k6 "$s" || rc=1
done
rm -f .env.load
docker compose up -d --force-recreate api >/dev/null 2>&1
exit $rc
