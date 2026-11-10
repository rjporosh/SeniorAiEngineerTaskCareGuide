#!/usr/bin/env bash
# Starts the dev infrastructure (loopback ports from compose.dev.yaml), applies migrations and runs
# the integration suites against real PostgreSQL, MongoDB, RabbitMQ and Redis. Run from the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env - run: cp .env.example .env" >&2; exit 1; }
set -a; . ./.env; set +a

if ! docker compose -f compose.yaml -f compose.dev.yaml --profile mongodb --profile bullmq up -d --wait postgres rabbitmq mongo redis minio; then
  echo "--- infrastructure did not become healthy; diagnostics:" >&2
  docker compose -f compose.yaml -f compose.dev.yaml --profile mongodb --profile bullmq ps -a >&2 || true
  for svc in mongo redis postgres rabbitmq minio; do echo "--- logs: $svc" >&2; docker compose -f compose.yaml -f compose.dev.yaml --profile mongodb --profile bullmq logs --tail 30 "$svc" >&2 || true; done
  exit 1
fi

# Tests get their own database so they can never pollute the development data.
TEST_DB="${POSTGRES_DB}_test"
docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tAc "SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'" | grep -q 1 \
  || docker compose exec -T postgres createdb -U "${POSTGRES_USER}" "${TEST_DB}"
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:55432/${TEST_DB}"
export TEST_DATABASE_URL="$DATABASE_URL"
export TEST_MONGODB_URI="mongodb://127.0.0.1:57017/docint_test"
export TEST_RABBITMQ_URL="amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@127.0.0.1:55672"
export TEST_REDIS_URL="redis://127.0.0.1:56379"
export PRISMA_HIDE_UPDATE_MESSAGE=1

pnpm --filter @docint/api exec prisma migrate deploy
pnpm --filter @docint/api test:int "$@"
