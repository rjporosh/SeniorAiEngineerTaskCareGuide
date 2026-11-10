# Operations

All commands run from the repository root.

## Start, stop, reset

```bash
cp .env.example .env                 # once; replace every CHANGE_ME
docker compose up --build            # everything: postgres, rabbitmq, minio, processor, migrate (one-shot), api, web
docker compose ps                    # all services should be (healthy); migrate exits 0
docker compose down                  # stop, keep data
docker compose down -v               # stop and DELETE all data volumes
```

Optional services: `--profile mongodb`, `--profile bullmq`, `--profile observability`.

Developer overlay (publishes infrastructure on loopback only): `docker compose -f compose.yaml -f compose.dev.yaml up -d postgres rabbitmq minio` → PostgreSQL `127.0.0.1:55432`, RabbitMQ `55672` (UI `55673`), MinIO `59000`, MongoDB `57017`, Redis `56379`.

## Migrations (PostgreSQL / Prisma)

Migrations live in `apps/api/prisma/migrations` and are applied automatically by the one-shot `migrate` service on every `docker compose up`. They are never auto-generated or auto-applied in production code paths, and `prisma migrate dev` is a developer-only tool.

```bash
# apply pending migrations by hand (same as the migrate service)
DATABASE_URL=postgresql://docint:<password>@127.0.0.1:55432/docint pnpm --filter @docint/api migrate

# add a migration after editing apps/api/prisma/schema.prisma (needs the dev overlay's postgres)
DATABASE_URL=… pnpm --filter @docint/api db:migrate:dev -- --name describe_the_change

# check that the schema file and the database agree (the only expected difference is the hand-written
# vector/full-text columns and indexes from migration 20261110000100_search_vectors)
DATABASE_URL=… pnpm --filter @docint/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
```

Rollback: Prisma migrations are forward-only. To undo a change, write a new migration that reverses it (and restore from backup if data was lost). MongoDB has no SQL migrations; indexes are created on connect (`mongo.repositories.ts`).

## Python dependencies (processor)

`services/document-processor/requirements.txt` lists the direct dependencies; `requirements.lock` pins the complete resolved set and is what the image installs (`pip install --no-deps -r requirements.lock`), so builds are reproducible and auditable. After changing `requirements.txt`, regenerate the lock:

```bash
docker run --rm -v "$PWD/services/document-processor:/w" python:3.13-slim sh -c \
  "pip install -q -r /w/requirements.txt && pip freeze | grep -vE '^(pip|setuptools|wheel)==' | sort > /w/requirements.lock"
```

CI runs `pip-audit` against the lock. PyMuPDF is pinned to the 1.x line because 2.x is a meta-package that also installs ONNX Runtime and other packages this service does not use.

## Backup and restore

```bash
# PostgreSQL
docker compose exec -T postgres pg_dump -U docint -Fc docint > backup-$(date +%F).dump
docker compose exec -T postgres pg_restore -U docint -d docint --clean --if-exists < backup-2026-11-10.dump

# Object storage (MinIO bucket "documents") — mirror with any S3 tool, or copy the volume:
docker run --rm -v docint_miniodata:/data -v "$PWD":/backup alpine tar czf /backup/minio-$(date +%F).tgz -C /data .
```

Back up the database **and** the bucket together: the database references objects by key. Retention: decide how long originals and extracted text are kept; deleting a document row without its object (or vice versa) leaves orphans. Encryption at rest is your platform's responsibility.

## Observability

| Signal | Where | Notes |
|---|---|---|
| Logs | `docker compose logs -f api` | One JSON object per line: `time, level, service, correlationId, userId, traceId, context, msg`. Ship stdout to Loki, Elasticsearch/Kibana, Graylog or Seq with the log driver or an agent; no code change needed |
| Metrics | `GET /api/v1/metrics` (needs `METRICS_TOKEN`) | `http_requests_total`, `http_request_duration_seconds`, `documents_processed_total{outcome,kind}`, `document_processing_duration_seconds`, `queue_messages{state}` |
| Traces | Jaeger at http://localhost:16686 | Enable by setting `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` (HTTP, Express, PostgreSQL, AMQP, Redis spans) |
| Dashboards | Grafana at http://localhost:3030 (`admin` / `GRAFANA_ADMIN_PASSWORD`) | "Document Intelligence - Overview" is provisioned |
| Health | `/api/v1/health/live`, `/api/v1/health/ready` | `ready` returns 503 and names the failing dependency |

Find everything about one request: copy the `traceId` from an error response (or the `X-Correlation-Id` header) and `docker compose logs api | grep <id>`; the worker logs for the same document carry the same correlation id.

## Scaling

Run more API replicas with `WORKER_ENABLED=false` for HTTP-only and separate replicas with `WORKER_ENABLED=true` for processing; `QUEUE_CONCURRENCY` sets parallel documents per worker, `processor_concurrency` (env `PROCESSOR_CONCURRENCY`) bounds OCR parallelism per processor container. The in-memory database must not be used with more than one replica.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| API exits at start with `Invalid configuration: - DATABASE_URL: required…` | A provider is selected without its connection setting; the message names the variable |
| Documents stay in *Waiting in queue* | Worker not consuming: check `docker compose logs api` for `consuming document.process`, `/health/ready` for `queue`, and that `WORKER_ENABLED=true` somewhere. Check backlog: `docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers` |
| Documents end *Failed — processor unavailable* | The processor was down or busy; fix it, then **Process again** (UI) or `POST /documents/{id}/reprocess` |
| Many *Rejected* with `CORRUPT_FILE` / `PDF_ENCRYPTED` | The files themselves are unusable; re-export without password and re-upload |
| `429 RATE_LIMITED` | Limit reached; raise `RATE_LIMIT_PER_MINUTE` / `LOGIN_RATE_LIMIT_PER_MINUTE`, and set `TRUST_PROXY=true` behind a proxy so clients are not all one IP |
| `/metrics` returns 404 | `METRICS_TOKEN` is not set (intentional) |
| Processor `ready` is 503 | Tesseract missing in the image; rebuild `processor` |
| Port already allocated | Change `API_PUBLIC_PORT` / `WEB_PUBLIC_PORT` in `.env` |
| MinIO image cannot be pulled | The compose file uses a pinned `bitnamilegacy/minio` tag; use `OBJECT_STORAGE_PROVIDER=local` or point `S3_*` at your own S3 |
| Dead-lettered messages | `docker compose exec rabbitmq rabbitmqctl list_queues` shows `docint.document.process.dlq`; BullMQ keeps them in the `failed` set. The document row already shows the failure |

## Deployment note

The web app is a Node server that proxies to a private API, so it cannot be hosted on Vercel/Netlify alone. Use any container host (the three images are `apps/api`, `apps/web`, `services/document-processor`) with managed PostgreSQL, RabbitMQ (or Redis) and S3 storage, and run `node migrate.mjs` once per release. Hosting configuration is intentionally not included yet.
