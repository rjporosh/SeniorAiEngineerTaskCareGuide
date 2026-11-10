# Roadmap — Five-Day Delivery

This roadmap is ordered by risk reduction and assignment value. Keep the scope tight: finish one end-to-end path before polishing secondary features.

## Day 1 — Foundation and vertical-slice skeleton

**Outcomes**
- Repository structure, pinned stable toolchain, workspace scripts.
- NestJS modular monolith and Next.js App Router booting.
- Python processing service booting.
- Docker Compose with healthchecks and persistent volumes.
- Environment validation and provider ports/adapters skeleton.
- PostgreSQL schema/migrations and initial document lifecycle.
- README quickstart and architecture diagram.

**Exit gate**
- `docker compose up --build` succeeds from a clean checkout after `.env` setup.
- API, web, Python service and selected dependencies become healthy.
- Basic API health endpoint and frontend page work.
- No secrets committed.

## Day 2 — Secure ingestion and document extraction

**Outcomes**
- Multi-file upload with file validation and bounded limits.
- Object storage adapter (MinIO default, local alternative).
- PDF digital text extraction.
- Scanned PDF/image OCR with page-batched processing.
- XLSX/XLS multi-sheet and CSV parsing.
- Processing status, attempts, error handling and queue publishing.
- Synthetic fixtures for all supported formats.

**Exit gate**
- Supported samples upload and produce extracted text/structured source blocks.
- Corrupt/oversized/unsupported inputs fail safely.
- A 1,000-page strategy is bounded and documented; run a representative load test if fixture/hardware permits.

## Day 3 — Invoice extraction and deterministic validation

**Outcomes**
- Versioned invoice JSON schema.
- Configurable LLM provider adapter and extraction prompt.
- Evidence and uncertainty handling.
- Deterministic financial validation and duplicate candidates.
- Cross-document PDF/Excel comparison for matched invoice fields.
- Persistence of extraction, issues and history.
- Unit and adapter contract tests.

**Exit gate**
- Missing fields remain null; model output is schema-validated.
- Totals and line items are checked deterministically.
- Manual-review reasons are visible in API response.

## Day 4 — Search, review UI and operational resilience

**Outcomes**
- Keyword search, filters and pagination.
- Semantic search on PostgreSQL/pgvector if time and model access permit.
- Document list/detail/review/correction/reprocess screens.
- Audit trail for corrections.
- Retry/dead-letter behavior and worker restart safety.
- Authentication/authorization hardening and API docs.
- Adapter switching smoke tests.

**Exit gate**
- Main user workflow works in browser.
- Corrections persist with actor/time/history.
- Failed jobs can be reprocessed without deleting history.
- No critical auth/upload vulnerabilities known from implemented checks.

## Day 5 — Verification, evaluation and submission

**Outcomes**
- Unit, integration, API, frontend and E2E smoke tests.
- Labeled evaluation set and script.
- Actual accuracy, latency, success/failure metrics.
- Performance checks for large documents.
- Dependency and container checks.
- README, architecture diagram, database schema, API examples, limitations.
- Recorded walkthrough script/checklist.
- Final Git hygiene check: `ai-handover.md` ignored and untracked.

**Exit gate**
- Clean clone + `docker compose up --build` demonstrated.
- Test commands and results are reproducible.
- Evaluation report contains measured data and methodology, not estimates.
- All required deliverables are present.

## Prioritization rule

If time is lost, cut in this order:
1. Fancy dashboard visualizations.
2. Advanced semantic ranking/reranking.
3. Broad cross-document matching beyond invoice-number/supplier/amount/date.
4. Optional provider combinations beyond the primary PostgreSQL + RabbitMQ path.

Do **not** cut:
- secure upload validation,
- correct OCR/spreadsheet parsing,
- no-hallucination structured extraction,
- deterministic financial validation,
- visible manual-review state,
- tests for core rules,
- honest evaluation and documentation.
