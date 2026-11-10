#!/usr/bin/env bash
# Switches database/queue providers by configuration only and runs the end-to-end smoke test for each combination.
# Usage: scripts/verify-providers.sh [combo ...]    (default: all)   e.g. postgres:rabbitmq mongodb:bullmq
set -uo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env - run: cp .env.example .env" >&2; exit 1; }
COMBOS=("$@"); [ ${#COMBOS[@]} -gt 0 ] || COMBOS=(postgres:rabbitmq postgres:bullmq mongodb:rabbitmq mongodb:bullmq memory:bullmq memory:rabbitmq)
RESULTS=(); FAIL=0
for combo in "${COMBOS[@]}"; do
  db="${combo%%:*}"; q="${combo##*:}"
  f=".env.combo"
  sed -e "s/^DATABASE_PROVIDER=.*/DATABASE_PROVIDER=$db/" -e "s/^QUEUE_PROVIDER=.*/QUEUE_PROVIDER=$q/" -e "s/^NODE_ENV=.*/NODE_ENV=production/" .env > "$f"
  [ "$db" = memory ] && sed -i.bak 's/^NODE_ENV=.*/NODE_ENV=development/' "$f" && rm -f "$f.bak"
  export ENV_FILE="$f"
  echo "=== $db + $q ==="
  docker compose --env-file "$f" --profile mongodb --profile bullmq up -d --wait --force-recreate postgres rabbitmq minio mongo redis processor >/dev/null 2>&1
  docker compose --env-file "$f" up -d --force-recreate migrate api >/dev/null 2>&1
  ok=0
  for _ in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${API_PUBLIC_PORT:-4000}/api/v1/health/ready" || true)
    [ "$code" = 200 ] && ok=1 && break; sleep 2
  done
  if [ $ok = 1 ]; then
    probes=$(curl -s "http://localhost:${API_PUBLIC_PORT:-4000}/api/v1/health/ready" | tr -d '\n')
    if node scripts/evaluate.mjs --smoke > /tmp/smoke-$db-$q.log 2>&1; then RESULTS+=("PASS  $db + $q  $probes"); else RESULTS+=("FAIL  $db + $q  (smoke: $(tail -3 /tmp/smoke-$db-$q.log | tr '\n' ' '))"); FAIL=1; fi
  else RESULTS+=("FAIL  $db + $q  (API never became ready: $(docker compose --env-file "$f" logs --tail 3 api 2>&1 | tr '\n' ' ' | cut -c1-300))"); FAIL=1; fi
done
unset ENV_FILE
rm -f .env.combo
docker compose up -d --force-recreate migrate api >/dev/null 2>&1   # restore the default configuration
printf '\n%s\n' "${RESULTS[@]}"
exit $FAIL
