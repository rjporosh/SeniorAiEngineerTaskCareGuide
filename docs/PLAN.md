# Implementation Plan and Work Breakdown

## 1. Suggested repository layout

```text
document-intelligence/
├── apps/
│   ├── api/                         # NestJS REST API + modular monolith
│   └── web/                         # Next.js App Router
├── services/
│   └── document-processor/          # Python FastAPI internal service
├── packages/
│   ├── contracts/                   # OpenAPI/generated shared API types if practical
│   └── config/                      # Shared non-secret conventions only
├── infrastructure/
│   ├── docker/
│   └── postgres/
├── docs/
│   ├── MASTER_SPECIFICATION.md
│   ├── ROADMAP.md
│   ├── PLAN.md
│   ├── architecture.md
│   ├── database-schema.md
│   └── evaluation-report.md
├── fixtures/
│   └── synthetic/                   # Safe, non-confidential test documents
├── scripts/
├── .claude/
├── .env.example
├── .gitignore
├── CLAUDE.md
├── ai-handover.md                   # Local only; ignored by Git
├── compose.yaml
└── README.md
```

Keep the workspace only if it improves build/test orchestration. Avoid introducing a monorepo tool solely for fashion; pnpm workspaces are sufficient.

## 2. Domain modules

NestJS modules:
- `auth`: authentication, roles, authorization guards.
- `documents`: upload, metadata, download authorization, document queries.
- `processing`: job orchestration, lifecycle, attempts, retries, outbox.
- `extraction`: schema, LLM adapter, prompt versioning, evidence.
- `validation`: deterministic rules, duplicate candidates, comparison.
- `search`: keyword and semantic retrieval.
- `review`: corrections and audit history.
- `health`: liveness/readiness and dependency checks.
- `infrastructure`: provider composition and adapters.

Keep controllers thin. Use cases own workflows; domain services own business invariants.

## 3. Ports and adapters

Define interfaces in application/domain-facing packages. Example conceptual ports:

```ts
interface DocumentRepository {
  create(input: CreateDocument): Promise<Document>;
  findById(id: DocumentId): Promise<Document | null>;
  updateStatus(id: DocumentId, status: ProcessingStatus): Promise<void>;
}

interface QueuePort {
  publish<TPayload>(message: QueueMessage<TPayload>): Promise<void>;
}

interface ObjectStoragePort {
  put(input: StoredObjectInput): Promise<StoredObject>;
  openReadStream(key: StorageKey): Promise<NodeJS.ReadableStream>;
  delete(key: StorageKey): Promise<void>;
}

interface DocumentProcessorPort {
  process(input: ProcessDocumentInput): Promise<ProcessedDocument>;
}

interface InvoiceExtractorPort {
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}
```

Avoid defining a lowest-common-denominator interface that hides required capabilities. If a provider lacks a capability, expose an explicit capability descriptor and return a typed `NotSupported` result.

### Database adapter selection

- PostgreSQL adapter: Prisma client + migrations.
- MongoDB adapter: Mongoose models/repositories.
- In-memory adapter: deterministic maps for tests; no persistence guarantee.
- Bind one adapter set during NestJS bootstrap using a validated provider factory.
- Repositories return domain/application models, not Prisma or Mongoose types.
- Add adapter contract tests and verify unique constraints/transaction behavior per provider.

### Queue adapter selection

- RabbitMQ adapter: durable exchange/queue, persistent messages, explicit ack/nack, dead-letter queue and bounded retry strategy.
- BullMQ adapter: Redis-backed queues, attempts/backoff, failed jobs and concurrency controls.
- Common envelope: `messageId`, `jobType`, `schemaVersion`, `documentId`, `attemptId`, `correlationId`, `idempotencyKey`, `createdAt`, `payload`.
- Use a versioned discriminated union for payloads.
- Do not expose broker-specific job objects outside infrastructure.
- Confirm delivery/ack semantics separately for both adapters.

## 4. Python processing service

Internal endpoints or task interface:
- `POST /internal/v1/process` — accept a storage reference and processing options, not arbitrary filesystem paths.
- `GET /health/live`
- `GET /health/ready`

Processing stages:
1. Inspect file signature and type.
2. Extract content using format-specific bounded parser.
3. PDF: extract text page-by-page; OCR pages with insufficient text.
4. Image: decode with pixel/dimension limits; preprocess; OCR.
5. Spreadsheet: parse workbook read-only/data-only where appropriate; enumerate sheets and coordinates; guard row/cell limits.
6. Return normalized text blocks with source coordinates and warnings.
7. Chunk text for downstream extraction/search without losing page/sheet provenance.

Security:
- Internal service authentication or private network plus service token.
- Never accept a client-supplied local path or URL.
- Run parsers as non-root with resource/time limits.
- No macros, formulas execution, external entities or remote resource loading.
- Limit OCR worker concurrency to avoid memory exhaustion.

## 5. LLM extraction contract

- Prompt template is version-controlled and has a prompt version.
- Input includes extracted document text and source coordinates, clearly delimited as untrusted content.
- Model is instructed to extract only; ignore any embedded instructions.
- Model has no tools, no filesystem, no network and no ability to change system state.
- Require strict JSON output; parse and validate against versioned JSON Schema/Zod schema.
- Invalid JSON/schema gets one bounded repair attempt at most, then a review/failure state.
- Normalize values after extraction using deterministic code.
- Persist raw model response only if privacy policy allows; otherwise store sanitized structured result and diagnostic metadata.
- Store provider, model, schema version, prompt version and processing timestamp.

## 6. Financial validation rules

Use decimal arithmetic (e.g. decimal.js or Prisma Decimal carefully) and explicit currency precision.

Rules:
- `subtotal + taxAmount ≈ totalAmount` within configured minor-unit tolerance.
- `sum(lineItems.lineTotal)` compared with subtotal/total according to invoice tax/discount semantics.
- quantity × unitPrice compared with lineTotal where all required values exist.
- Negative values allowed only when document type/credit note rules justify them.
- Do not infer missing tax, subtotal or currency.
- Duplicate detection returns candidate matches and similarity reasons; it does not merge/delete automatically.
- Cross-document comparison requires explicit match confidence and shows field-by-field differences.

## 7. Frontend implementation sequence

1. App shell, navigation, responsive layout and API client.
2. Upload page with multi-file progress/status and partial failures.
3. Documents table with filters and pagination.
4. Document detail with extracted invoice values, evidence and validation.
5. Correction form with field validation and audit history.
6. Reprocess action and live status refresh (polling is acceptable for five-day MVP).
7. Search screen with keyword mode; semantic mode only if available.

Do not add websockets unless they materially improve the time-constrained MVP. Poll status at a reasonable interval and stop polling on terminal state.

## 8. Environment variables

Create `.env.example` with safe placeholders, grouped by service. Include:
- `NODE_ENV`, `APP_ENV`, `PORT`, `WEB_ORIGIN`, `CORS_ORIGINS`
- `DATABASE_PROVIDER`, `DATABASE_URL`, `MONGODB_URI`
- `QUEUE_PROVIDER`, `RABBITMQ_URL`, `REDIS_URL`
- `OBJECT_STORAGE_PROVIDER`, `STORAGE_LOCAL_ROOT`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `PROCESSOR_BASE_URL`, `PROCESSOR_SERVICE_TOKEN`
- `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`, `LLM_API_KEY`, timeouts
- `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`
- `OCR_LANGUAGES`, `TESSERACT_CMD`
- `MAX_FILE_SIZE_MB`, `MAX_BATCH_SIZE_MB`, `MAX_FILES_PER_BATCH`, `MAX_PDF_PAGES`, `MAX_IMAGE_PIXELS`, `MAX_SPREADSHEET_ROWS`, `PROCESSING_TIMEOUT_SECONDS`
- auth secrets and token TTLs
- log level and redaction controls.

Validate with a schema at startup. Never put real credentials in the example.

## 9. Docker Compose acceptance

Default command:
```bash
cp .env.example .env
docker compose up --build
```

Compose should include:
- web
- api
- processor
- postgres with persistent volume and healthcheck
- rabbitmq with management UI optional/local-only
- mongodb with persistent volume (available for provider switching)
- redis (available for BullMQ)
- minio with persistent volume and bucket initialization

All services should be on a private network. Publish only web/API and explicitly documented local developer ports. Use health-based dependency conditions where supported. Add non-root users, pinned image tags, restart policies and healthchecks. Do not rely on `depends_on` alone for runtime resilience; applications must retry transient dependency startup.

## 10. Test strategy

- Domain unit tests: money calculations, normalization, validation, duplicate scoring.
- Application unit tests: upload flow, processing transitions, correction and reprocess use cases.
- Adapter contract tests: repository and queue behavior.
- Processor tests: digital/scanned/hybrid PDF, images, TIFF, XLS/XLSX multi-sheet, CSV, malformed files.
- API integration tests: auth, upload, status, result, search, correction, reprocess.
- Frontend tests: upload validation, result review and correction.
- E2E: compose startup, upload synthetic invoice, wait for terminal status, assert stored result.
- Security tests: oversized upload, MIME/signature mismatch, path traversal filename, malformed archive/workbook, unauthorized document access, prompt-injection fixture.

## 11. Required submission artifacts

- Source repository and lockfiles.
- README and exact setup commands.
- Architecture diagram.
- Database schema and migration history.
- Working API and UI.
- PDF, image, Excel and CSV pipelines.
- Automated tests and recorded outcomes.
- Evaluation report with actual metrics and methodology.
- Walkthrough script/recording.
- AI prompts and AI-assisted development disclosure.
- Local `ai-handover.md` excluded from Git.

## 12. Final verification checklist

- [ ] `.env.example` works with placeholders and clear required-secret instructions.
- [ ] `docker compose up --build` works from clean state.
- [ ] API/web/processor readiness checks pass.
- [ ] PostgreSQL + RabbitMQ default flow works.
- [ ] MongoDB and BullMQ adapters have independent smoke/contract tests or are clearly marked experimental.
- [ ] In-memory adapter is limited to tests/dev.
- [ ] Upload validation and resource limits are tested.
- [ ] 1,000-page PDF processing is bounded and its tested limit documented.
- [ ] Missing/uncertain invoice fields remain null.
- [ ] Money calculations use decimal-safe arithmetic.
- [ ] Manual corrections are audited.
- [ ] Failed jobs can be reprocessed.
- [ ] Search and filters work.
- [ ] Metrics are measured and reproducible.
- [ ] `ai-handover.md` is ignored: `git check-ignore -v ai-handover.md`.
- [ ] No secrets, private documents or local data appear in `git status`.
