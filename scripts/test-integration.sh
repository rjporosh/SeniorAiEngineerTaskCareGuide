#!/usr/bin/env bash
# Starts the dev infrastructure (loopback ports from compose.dev.yaml), applies migrations and runs
# the integration suites against real PostgreSQL, MongoDB, RabbitMQ and Redis. Run from the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env - run: cp .env.example .env" >&2; exit 1; }
set -a; . ./.env; set +a

docker compose -f compose.yaml -f compose.dev.yaml --profile mongodb --profile bullmq up -d --wait postgres rabbitmq mongo redis minio

export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:55432/${POSTGRES_DB}"
export TEST_DATABASE_URL="$DATABASE_URL"
export TEST_MONGODB_URI="mongodb://127.0.0.1:57017/docint_test"
export TEST_RABBITMQ_URL="amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@127.0.0.1:55672"
export TEST_REDIS_URL="redis://127.0.0.1:56379"
export PRISMA_HIDE_UPDATE_MESSAGE=1

pnpm --filter @docint/api exec prisma migrate deploy
pnpm --filter @docint/api test:int "$@"
