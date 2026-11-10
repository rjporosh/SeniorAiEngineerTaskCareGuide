# Testing

| Layer | What it proves | Command (from the repo root) | Needs |
|---|---|---|---|
| API unit + HTTP | Domain rules, validation, extraction, auth, upload limits, review/search/reprocess, metrics — over **real HTTP** with the in-memory adapter and a scripted processor | `pnpm --filter @docint/api test` | Node only |
| Adapter contracts | PostgreSQL, MongoDB and in-memory repositories behave identically; RabbitMQ and BullMQ behave identically (retry, dead-letter, ack-after-handler) | `./scripts/test-integration.sh` | Docker (starts the containers; uses the separate `docint_test` database) |
| Processor | Digital/scanned/hybrid PDF, images, multi-frame TIFF, XLSX/XLS/CSV, corrupt/encrypted/zip-bomb/oversize files, auth, 1000-page PDF | `docker build --target test -t docint-processor-test services/document-processor && docker run --rm -e PROCESSOR_SERVICE_TOKEN=test-token-0123456789 docint-processor-test` | Docker (Tesseract is inside the image) |
| UI components | Status/stamp wording, sign-in errors and CSRF header, upload validation, formatting | `pnpm --filter @docint/web test` | Node only |
| Browser journeys | Sign-in, upload → processing → evidence → correction → reprocess → search, keyboard access, mobile layout (also writes screenshots) | `pnpm --filter @docint/e2e install:browsers && pnpm --filter @docint/e2e test` | Running stack (`docker compose up -d`) |
| End-to-end smoke | Real upload through MinIO, RabbitMQ/BullMQ, the processor and the database | `node scripts/evaluate.mjs --smoke` | Running stack |
| Provider matrix | Every database × queue combination, switched by configuration only | `./scripts/verify-providers.sh` | Docker |
| Evaluation | Field accuracy, review precision/recall, latency, throughput on 80 labelled documents | `node scripts/evaluate.mjs` | Running stack |
| Load / stress / spike | Latency and error budgets under traffic, rate limiter, upload backlog drain | `./scripts/run-load.sh` | Docker |

Static checks: `pnpm typecheck`, `pnpm lint` (workspace-wide), `docker compose config -q`.

## Conventions

- **Write the contract once.** New persistence or queue adapters must pass `repository.contract.ts` / `queue.contract.ts` unchanged.
- Integration tests (`*.int.spec.ts`) are excluded from the default `test` run and fail loudly (not skip) when their infrastructure variables are missing.
- A bug found by the evaluation or in review gets a regression test *before* the fix (examples: the duplicate-race test, `12e3` amount parsing, `2026-02-30` date roll-over).
- Fixtures are synthetic and generated deterministically: `./scripts/generate-dataset.sh` (seed 20261110). Never commit real invoices.

## CI

`.github/workflows/ci.yml` (all jobs green on GitHub-hosted runners on the latest commit; the optional Vercel deploy job is skipped unless opted in) runs static checks, API and UI tests, processor tests, adapter contracts, the browser journeys and the smoke test, a dependency audit, and builds all images with a vulnerability scan.
