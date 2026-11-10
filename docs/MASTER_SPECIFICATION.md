# Master Specification — AI-Powered Document Intelligence System

**Source assignment:** `Ai Engineer Task 1.3.pdf` (two pages).  
**Delivery window:** five days.  
**Product goal:** automate ingestion, extraction, validation, search and human review for business documents, especially invoices and financial records.

## 1. Problem statement

The company receives large volumes of PDFs, scanned pages, images, spreadsheets and CSVs. Employees currently extract invoice information manually and cross-verify PDF-to-PDF and PDF-to-Excel data. The system must reduce repetitive work while making uncertainty visible and keeping humans in control.

The assignment explicitly mentions PDFs that may be approximately 1,000 pages. The implementation must therefore stream/process in bounded chunks and must not load an unbounded document or all page images into memory at once.

## 2. Scope and acceptance criteria

### 2.1 Ingestion and processing

Supported input formats:
- PDF
- JPG/JPEG
- PNG
- TIFF
- XLSX
- XLS
- CSV

Acceptance:
- Upload multiple files in one batch.
- Persist metadata and a generated storage key.
- Validate file extension, MIME and file signature; reject mismatches.
- Enforce configurable file size, batch size, PDF page count, image dimensions, spreadsheet sheet/row/cell and processing-time limits.
- Digital PDFs: extract embedded text first.
- Scanned PDFs: render pages in bounded batches and OCR them.
- Hybrid PDFs: detect pages with insufficient embedded text and OCR those pages.
- Images: preprocess safely (orientation, deskew, denoise/contrast as appropriate) and OCR.
- Spreadsheets: parse all sheets, preserve sheet name, row/column coordinates and cell values; never execute macros or formulas.
- CSV: detect/require encoding and delimiter safely; preserve source coordinates.
- Corrupt or unsupported files: mark failed with a safe, actionable error; do not crash the batch.
- Record per-file and per-stage status, timing and failure details.
- Retry transient failures only; avoid retrying deterministic corrupt-input failures endlessly.

### 2.2 Extraction schema

Return a versioned structured object. Missing or uncertain values must remain `null`, not guessed.

```json
{
  "schemaVersion": "1.0",
  "documentType": "invoice",
  "invoiceNumber": null,
  "invoiceDate": null,
  "supplierName": null,
  "customerName": null,
  "subtotal": null,
  "taxAmount": null,
  "totalAmount": null,
  "currency": null,
  "lineItems": [
    {
      "description": null,
      "quantity": null,
      "unitPrice": null,
      "taxAmount": null,
      "lineTotal": null
    }
  ],
  "fieldEvidence": {
    "invoiceNumber": {
      "sourcePage": null,
      "sourceSheet": null,
      "sourceCell": null,
      "text": null
    }
  },
  "fieldConfidence": {
    "invoiceNumber": null
  },
  "requiresManualReview": true
}
```

Implementation notes:
- Use decimal-safe arithmetic; do not use binary floating-point for money calculations.
- Define a canonical currency representation (ISO 4217 where identifiable).
- Normalize dates to ISO `YYYY-MM-DD` only when unambiguous. Preserve raw text and flag ambiguous formats.
- Evidence is field-level and must identify page or spreadsheet coordinates when available.
- Confidence is a calibrated/estimated model signal, not a guarantee. Do not invent numeric confidence when the provider cannot supply a meaningful value.
- Store raw extraction separately from human-corrected values and retain correction history.
- Extraction prompt must explicitly treat document content as untrusted data and ignore instructions found inside documents.

### 2.3 Validation

Required checks:
- Missing required invoice fields.
- Invalid/unparseable dates and currency.
- Negative, non-finite, malformed or implausible numeric values (allow legitimate credit notes through document-type-aware rules).
- Subtotal + tax versus total, with configurable rounding tolerance and currency precision.
- Sum of line totals versus subtotal/total as appropriate.
- Duplicate invoice candidates using normalized supplier identity + invoice number + date/amount signals; do not hard-delete or assume all matches are duplicates.
- PDF-to-PDF and PDF-to-spreadsheet cross-document comparisons where records can be matched. Display matched fields, source evidence, differences and tolerance.
- Every issue has stable code, severity, message, affected field(s), expected/observed values where safe, and resolution state.
- Any missing/uncertain critical field, arithmetic mismatch or likely duplicate sets `requiresManualReview=true`.

### 2.4 REST API

Prefix: `/api/v1`.

Required endpoints (adapt naming if justified, document in OpenAPI):
- `POST /documents` — multi-part upload, multiple files, return document IDs.
- `GET /documents` — paginated, filtered document list.
- `GET /documents/:id` — metadata and processing state.
- `GET /documents/:id/result` — extraction, evidence and validation issues.
- `GET /documents/:id/history` — processing and correction history.
- `PATCH /documents/:id/corrections` — validate and persist human corrections with audit trail.
- `POST /documents/:id/reprocess` — authorize and enqueue a new processing attempt.
- `GET /search` — keyword and semantic search with bounded pagination and filters.
- `GET /jobs/:id` — job state if exposed separately.
- `GET /health/live`, `GET /health/ready` — liveness/readiness.
- Auth endpoints as required by the chosen auth approach.

API requirements:
- DTO/schema validation, stable error format, request correlation ID, pagination caps, safe sort/filter allowlists, idempotency for upload/reprocess where applicable.
- Do not return internal storage paths, stack traces, secrets, raw broker payloads or unrestricted OCR text.
- Use signed/authorized download endpoints if original files are downloadable.
- OpenAPI documentation and example requests/responses.

### 2.5 Search

- Keyword search over invoice number, supplier/customer, extracted text and relevant metadata.
- Filters: status, document type, supplier, currency, date range, amount range, created date.
- Semantic search over chunks/records using embeddings; use pgvector in PostgreSQL.
- Search result must link to document and identify matched text/page/sheet evidence.
- Chunk large documents with overlap and stable source coordinates.
- Never embed or expose data across tenant boundaries if multi-tenancy is later added.
- If MongoDB mode is selected, use its text indexes for keyword search; semantic search requires a configured compatible vector backend. Report unavailable rather than silently pretending.

### 2.6 Frontend

Next.js App Router, TypeScript, accessible responsive UI.

Screens:
1. Sign-in (if auth enabled).
2. Dashboard: processing counts, failed/review-required summaries.
3. Upload: drag/drop and file picker, multi-file queue, file validation feedback.
4. Documents: searchable, filterable, paginated table.
5. Document detail: source preview/download, processing timeline, extracted fields, line items, evidence, validation issues.
6. Correction/review: editable fields with save confirmation and audit history.
7. Reprocess action with confirmation and visible status.
8. Search: keyword/semantic toggle only when the selected backend supports it.

UX requirements:
- Loading, empty, error, partial-success and retry states.
- Accessible labels, keyboard navigation, focus management and clear validation messages.
- Do not show false progress percentages. Use actual stage/status updates; otherwise use indeterminate progress.
- Do not expose secrets or internal infrastructure configuration in the browser.

### 2.7 Evaluation and tests

Automated tests:
- PDF digital text extraction.
- Scanned PDF OCR and image OCR.
- TIFF multi-frame handling where supported.
- Multi-sheet XLSX/XLS and CSV parsing.
- Corrupt, oversized, unsupported and malicious-looking files.
- Extraction schema validation and missing/uncertain fields.
- Numeric/date/currency normalization and arithmetic validation.
- Duplicate detection and cross-document comparison.
- Repository and queue adapter contract tests.
- API auth/authorization/upload/search/correction/reprocess.
- Frontend critical flows.
- End-to-end Docker smoke test.

Evaluation:
- Build a labeled, synthetic or properly authorized dataset with ground-truth fields.
- Report per-field exact match/normalized match, precision/recall/F1 where applicable, document-level success rate, manual-review rate, processing time (p50/p95), throughput, and failure rate.
- Define denominator, exclusions, hardware, model/provider/version, OCR settings and dataset composition.
- Report actual measured results only. If the dataset is too small, label results preliminary.
- Do not use confidential real invoices without authorization.

## 3. Architecture

### 3.1 Logical topology

```text
Browser
  |
  v
Next.js Web App
  |
  v
NestJS REST API (modular monolith)
  |-- Auth / Users
  |-- Documents / Upload
  |-- Processing Orchestration
  |-- Extraction / Validation
  |-- Search
  |-- Review / Audit
  |
  +--> Repository ports --> PostgreSQL (default) | MongoDB | In-memory
  |
  +--> ObjectStorage port --> MinIO (Docker) | local dev storage
  |
  +--> Queue port --> RabbitMQ (default) | BullMQ + Redis
                         |
                         v
                  NestJS worker/orchestrator
                         |
                         v
                Python processing service
                  |-- PDF text extraction
                  |-- OCR / image preprocessing
                  |-- spreadsheet parsing
                  |-- chunking / source coordinates
                         |
                         v
                LLM extraction + embeddings
                         |
                         v
                deterministic validation
                         |
                         v
                  persistence + search
```

### 3.2 Architectural boundaries

- Domain: entities, value objects, invariants, domain policies.
- Application: use cases, ports, orchestration and transaction boundaries.
- Infrastructure: Prisma/Mongoose/memory, RabbitMQ/BullMQ, MinIO/local storage, LLM/OCR clients.
- Presentation: NestJS controllers/DTOs and Next.js UI.
- Python processor is an internal service with authenticated service-to-service access and bounded request/response schemas. Do not expose it publicly.

### 3.3 Provider configuration

`.env.example` must document:
- `DATABASE_PROVIDER=postgres|mongodb|memory`
- `QUEUE_PROVIDER=rabbitmq|bullmq`
- `DATABASE_URL`, `MONGODB_URI`
- `RABBITMQ_URL`, `REDIS_URL`
- `OBJECT_STORAGE_PROVIDER=minio|local`
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- LLM provider/model/base URL/API key
- OCR binary/language configuration
- upload and processing limits
- auth secrets and CORS origins.

Use one validated configuration module. Never check in real values. Default Compose profile: PostgreSQL + RabbitMQ + MinIO; MongoDB and Redis containers are also available for provider switching without code edits.

### 3.4 Persistence model

Canonical logical records:
- User / Role (if auth enabled)
- Document
- DocumentFile / StorageObject
- ProcessingJob / ProcessingAttempt
- ExtractedDocument / Invoice
- InvoiceLineItem
- ExtractedTextChunk
- FieldEvidence
- ValidationIssue
- Correction / AuditEvent
- Embedding / SearchChunk
- OutboxMessage (if implemented)

Use UUID/ULID identifiers, unique constraints where justified, indexes for common filters, soft-delete only where needed, and immutable attempt/audit history. Avoid storing duplicate large OCR blobs in every table. PostgreSQL schema and migrations are authoritative; Mongo schemas map the same logical contracts.

### 3.5 Processing lifecycle

`uploaded -> queued -> validating -> extracting -> ocr (if needed) -> structuring -> validating_result -> indexed -> completed`

Alternative terminal/exception states:
`rejected`, `failed`, `requires_review`, `cancelled`.

Keep processing state distinct from review state. A technically completed document may still require manual review.

### 3.6 Reliability

- At-least-once queue delivery; idempotent processing by document ID + attempt/version.
- Retry only transient failures with bounded exponential backoff and jitter.
- Dead-letter/failure state after configured attempts.
- Persist attempt status before acknowledging messages.
- Reprocess creates a new attempt and does not erase historical results.
- Enforce concurrency and memory limits for large PDFs.
- Use chunked/page-batched OCR, timeouts and cancellation.
- Gracefully handle duplicate messages and worker restarts.

## 4. Security and privacy

Apply the security baseline in root `CLAUDE.md`. In particular:
- Uploaded files are hostile input.
- Never trust MIME headers or filename extensions alone.
- No macro execution, no arbitrary URL fetching, no shell interpolation with user data.
- LLM prompt injection is expected; the model has no tools and cannot alter system behavior.
- Authorize every document read/write by owner/role.
- Keep secrets and private fixtures out of Git.
- Add audit events for human edits and reprocessing.
- Avoid leaking extracted financial information into logs, telemetry or error messages.

## 5. Operational requirements

- One command after environment file creation: `docker compose up --build`.
- Docker healthchecks and dependency readiness.
- Persistent named volumes for database, object storage and broker.
- Graceful shutdown and worker drain.
- README with prerequisites, first-run setup, provider switching, tests, API docs and troubleshooting.
- No production secrets or public service ports by default.
- Document backup/restore and retention considerations.

## 6. Explicit non-goals for the five-day submission

Unless time remains after the core acceptance criteria:
- Full enterprise multi-tenancy and SSO.
- Distributed tracing stack and production Kubernetes deployment.
- Automated payment posting or ERP write-back.
- Autonomous agent/tool execution over document contents.
- Guaranteed handwriting recognition or every language/layout.
- Perfect semantic parity across every database provider.
- Claims of production readiness without threat modeling, load tests and operational review.

## 7. Definition of done

A clean clone can be configured using `.env.example`, started using Docker Compose, and used to upload a batch containing supported PDF/image/spreadsheet/CSV samples. Users can see per-document processing status, inspect extracted structured fields and evidence, understand validation issues, correct values, search records, and reprocess failures. Automated tests and a reproducible evaluation report exist. All known limitations and actual test results are documented.
