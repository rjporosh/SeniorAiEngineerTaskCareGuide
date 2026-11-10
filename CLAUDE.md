# Claude Code Project Instructions

You are the principal engineer and implementation agent for **AI-Powered Document Intelligence System**. Build the assignment in `docs/MASTER_SPECIFICATION.md`; execute the staged work in `docs/ROADMAP.md` and `docs/PLAN.md`.

## Mission and working style

- Deliver a working, secure, explainable, maintainable system—not a demo that only looks complete.
- The submission deadline is five days. Prioritize a complete vertical slice and honest measured evaluation over speculative features.
- Read `docs/MASTER_SPECIFICATION.md`, `docs/ROADMAP.md`, and `docs/PLAN.md` before coding. Read `ai-handover.md` if present; it is local working context and MUST NOT be committed.
- Keep `ai-handover.md` current after meaningful milestones: architecture decisions, commands, completed work, known defects, next steps, and test status.
- Work in small, verifiable increments. Before changing code, inspect the existing repository and preserve working conventions. Do not overwrite user work.
- Do not claim a feature, test, benchmark, security control, or metric is complete unless you ran it and observed the result.
- If a requirement cannot be completed within the deadline, document the limitation, risk, and next step. Never fabricate evaluation results.
- Prefer boring, well-supported engineering over unnecessary abstractions, premature microservices, or clever code.

## Selected stack

- Frontend: latest stable Next.js App Router + React + TypeScript; use `pnpm`.
- API/backend: latest stable NestJS + TypeScript on an active Node.js LTS release.
- Document processing: Python service using FastAPI only for the internal service boundary; PyMuPDF/pdfplumber, Tesseract OCR, OpenCV, pandas, and openpyxl as appropriate.
- Primary database: PostgreSQL. Optional adapters: MongoDB and in-memory (test/development only).
- Primary queue: RabbitMQ. Optional adapter: BullMQ backed by Redis.
- Object storage: local filesystem for development with a storage port; MinIO S3-compatible adapter for Docker/local integration.
- Search: PostgreSQL full-text search + pgvector for semantic vectors in the primary profile. MongoDB profile must provide equivalent keyword search and a documented semantic-search adapter or explicitly report semantic search unavailable unless configured.
- Docker Compose is the one-command local orchestration entry point.

Do not pin speculative versions from memory. At project creation, inspect official release channels and package registries, choose mutually compatible **stable** releases (not alpha, beta, RC, canary, nightly), pin exact versions in manifests/lockfiles and Docker image tags, and record the versions in README. Prefer active LTS Node.js. The checked baseline on 2026-11-10 is Node.js 26 LTS, NestJS 12, Next.js 16 stable, React 19.3, and RabbitMQ 4.4; verify current patch versions and compatibility before pinning. PostgreSQL 18 is the stable production line; PostgreSQL 19 RC is not for production. Cite official documentation in the README's technology decisions.

## Architecture rules

- Use a modular monolith for the NestJS business backend, plus a separately deployable Python document-processing service. Do not split every domain into a microservice.
- Enforce dependency direction: presentation/API -> application -> domain; infrastructure implements ports defined inward. Domain/application must not import Prisma, Mongoose, BullMQ, amqplib, FastAPI, or framework-specific transport code.
- Define explicit ports for repositories, queue publishing/consumption, object storage, OCR/document processing, LLM extraction, embeddings, and clock/ID generation where useful.
- Select adapters once at composition/bootstrap time from validated environment configuration. Do not scatter `if (DATABASE_PROVIDER...)` through use cases.
- Database providers: `postgres`, `mongodb`, `memory`. Queue providers: `rabbitmq`, `bullmq`. Fail fast for unknown or incompatible settings.
- PostgreSQL is the canonical schema and production path. Use Prisma migrations for PostgreSQL. MongoDB uses a separate Mongoose adapter/schema and indexes. In-memory is for tests and local smoke use only; it is non-durable and not suitable for production or multiple replicas.
- Queue abstraction must define job names, versioned payload schemas, correlation IDs, idempotency keys, retry policy, dead-letter behavior, and health checks. RabbitMQ and BullMQ have different delivery semantics; document and normalize only the application contract, not pretend the brokers are identical.
- Assume at-least-once delivery. Make handlers idempotent. Acknowledge only after durable state transitions. Use an outbox pattern for reliable DB-to-queue publication where feasible; explain any five-day simplification.
- Keep file bytes outside the relational database. Store metadata and an opaque storage key. Never expose local filesystem paths to clients.
- Never pass raw uploaded document text to logs. Redact secrets and sensitive values.
- Use UTC timestamps internally and ISO-8601 in APIs.

## Required product capabilities

Implement the seven assignment tasks:
1. Upload multiple PDF, JPG, PNG, TIFF, XLSX, XLS, CSV files; extract digital PDF text, OCR scanned PDFs/images, parse multiple spreadsheet sheets; handle large multi-page PDFs, low-quality images, corrupt files and limits.
2. Extract invoice number/date, supplier/customer, subtotal, tax, total, currency and line items. Return schema-validated JSON. Missing/uncertain values must be null/unknown with evidence and confidence; never hallucinate.
3. Validate required fields, numeric values, duplicate invoices and arithmetic consistency; mark manual review.
4. REST endpoints for upload, status, results, search, corrections and failed-job reprocessing.
5. Persist metadata, extracted text, structured data, validation issues and processing history; keyword and semantic search.
6. Next.js UI for multi-upload, progress, result inspection, corrections, validation issues and search.
7. Automated tests and a labeled evaluation dataset/report with actual accuracy, latency, success and failure measurements.

## Security baseline (non-negotiable)

- Validate configuration at startup; do not silently fall back to insecure defaults.
- Use DTO validation, strict schemas, allowlists, bounded pagination, request size limits, rate limits and safe error responses.
- Upload validation must combine extension allowlist, MIME sniffing and file signature checks. Treat filenames as untrusted; generate storage keys. Enforce per-file and total-batch limits, page/sheet/row limits, decompression-bomb protections and processing timeouts.
- Store uploads outside the web root; use least-privilege container users; scan/quarantine where feasible. Never execute macros or embedded content.
- Protect against path traversal, ZIP bombs, XML external entities, formula injection, CSV injection, parser exploits and SSRF. Do not fetch document-supplied URLs.
- Use authentication and role-based authorization for upload, view, correction, reprocess and administration. For a five-day submission, implement a defensible local auth strategy or clearly isolate demo auth; never leave production routes open by accident.
- Apply secure headers, CORS allowlist, CSRF protection where cookie auth is used, secure/HttpOnly/SameSite cookies, password hashing with Argon2id, short-lived access tokens and refresh-token rotation if JWT auth is used.
- Secrets only in ignored `.env`; provide `.env.example` with placeholders. Never commit credentials, API keys, real invoices or private evaluation data.
- Encrypt transport in deployed environments; document at-rest encryption responsibility. Do not claim encryption at rest unless configured and tested.
- Use parameterized queries/ORM, output encoding, safe Markdown rendering and no dynamic code execution.
- Use non-root Docker users, pinned images, healthchecks, resource limits where practical, private internal networks, and avoid publishing database/queue ports beyond local development.
- Keep audit trails for manual corrections and reprocessing; preserve original extraction and correction history.
- Treat document contents and LLM outputs as untrusted input. Defend against prompt injection: the model extracts data only; it must never follow instructions embedded in documents or invoke tools.
- LLM output must pass strict JSON Schema validation and deterministic business validation. Store model/provider/version, prompt version, timestamps and confidence/evidence. Never use LLM output as executable instructions.
- Do not log authorization headers, passwords, tokens, raw OCR text, full invoice contents, or secrets.

## Code quality

- TypeScript strict mode. Avoid `any`; use `unknown` plus validation at boundaries.
- Small cohesive modules, explicit names, simple functions, dependency injection, typed errors and centralized error mapping.
- No giant services/controllers, no business logic in controllers, no duplicated validation, no hidden global state.
- Use structured logging with correlation IDs and redaction.
- Add unit tests for domain/application rules, adapter contract tests, API integration tests, and end-to-end smoke tests.
- Use linting, formatting, typechecking, dependency auditing and lockfiles.
- Add OpenAPI/Swagger documentation and a versioned API prefix.
- Use migrations and deterministic seed data. Do not auto-run destructive schema synchronization in production.
- Every meaningful change must run relevant tests and report exact commands/results.

## Execution protocol

1. Inspect repository, runtime, package manager and current files. Do not assume an empty repository.
2. Write/confirm architecture and file tree before broad implementation.
3. Implement the smallest complete vertical slice: upload -> durable metadata -> queued job -> extract/OCR -> LLM structured extraction -> deterministic validation -> persisted result -> UI review.
4. Keep `docker compose up --build` as the default local startup command. It must start all required default services and pass health checks. Do not require a hidden manual setup step. Provide a separate one-time `.env` copy instruction.
5. Provide an explicit environment switch for PostgreSQL/MongoDB/in-memory and RabbitMQ/BullMQ. Docker Compose should include all selectable local dependencies so switching configuration does not require editing source code.
6. Verify all supported provider combinations that are claimed. At minimum test PostgreSQL+RabbitMQ, PostgreSQL+BullMQ, MongoDB+RabbitMQ, and in-memory+BullMQ. If a combination is not verified, label it experimental.
7. Before finishing: run formatting, lint, typecheck, unit/integration tests, build, Docker Compose startup and health checks. Record failures honestly.
8. Update README, architecture diagram, schema, API examples, evaluation report and `ai-handover.md`.
9. Ensure `ai-handover.md` is ignored by Git and not staged or committed. Check `git status --short` and `git check-ignore -v ai-handover.md`.

## Git hygiene

- Never commit `.env`, secrets, uploads, test customer data, generated artifacts, local databases, or `ai-handover.md`.
- Commit `.env.example`, lockfiles, migrations, tests, documentation and safe synthetic fixtures.
- Keep commits focused and conventional (e.g. `feat(documents): add secure batch upload`).
- Do not rewrite public history or force-push unless explicitly asked.

## Definition of done

A reviewer can clone the repository, copy `.env.example` to `.env`, run `docker compose up --build`, open the frontend, upload a supported document, see processing status, inspect extracted values/evidence/validation issues, correct a field, search documents, and reprocess a failed job. Automated tests pass, measured evaluation is reproducible, and all known limitations are documented.
