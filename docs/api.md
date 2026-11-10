# API reference

Base path `/api/v1`. Interactive OpenAPI: `/api/docs` (set `API_DOCS_ENABLED=true` outside development). All routes except `auth/login`, `auth/refresh`, `auth/logout` and the health probes need `Authorization: Bearer <access token>`.

## Response envelope

Every JSON response has the same shape, so clients handle success and failure once.

```jsonc
// success
{ "success": true, "data": { }, "traceId": "7c1f…", "timestamp": "2026-11-10T16:20:11.000Z" }

// failure: ALL problems are reported together
{
  "success": false, "code": "VALIDATION_FAILED", "message": "Request validation failed",
  "errors": [
    { "code": "too_small", "field": "page", "message": "Too small: expected number to be >=1" },
    { "code": "invalid_value", "field": "status", "message": "Invalid option: expected one of …" }
  ],
  "traceId": "7c1f…", "timestamp": "…"
}
```

`traceId` equals the `X-Correlation-Id` response header (send your own well-formed `X-Correlation-Id` to correlate; malformed values are ignored). Stack traces, SQL and connection strings are never returned.

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed request (e.g. not multipart) |
| 401 | `UNAUTHENTICATED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `TOKEN_REUSED` | Authentication problems |
| 403 | `FORBIDDEN` | Role does not allow it |
| 404 | `NOT_FOUND` | Missing **or not yours** (existence is not revealed) |
| 409 | `CONCURRENT_MODIFICATION`, `ALREADY_PROCESSING`, `NOT_CORRECTABLE`, `EMAIL_TAKEN` | State conflicts |
| 413 / 422 | `FILE_TOO_LARGE`, `BATCH_TOO_LARGE`, `VALIDATION_FAILED` | Limits and validation |
| 429 | `RATE_LIMITED` | Too many requests |
| 501 | `NOT_SUPPORTED` | e.g. semantic search on MongoDB |
| 500 | `INTERNAL_ERROR` | Quote the `traceId` |

Roles: **admin** (everything), **reviewer** (see all documents; correct, resolve issues, reprocess), **uploader** (upload; see own documents; reprocess own *failed* documents).

## Endpoints

| Method & path | Purpose |
|---|---|
| `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me` | Sign in (rate limited), rotate refresh token (reuse revokes the family), sign out, current user |
| `POST /auth/users` (admin) | Create a user |
| `POST /documents` | Multipart upload, field `files`, many files. Optional `Idempotency-Key` header |
| `GET /documents` | Paginated list. Filters: `status, reviewStatus, documentType, supplier, currency, invoiceDateFrom/To, minAmount, maxAmount, createdFrom/To, text`; `sortBy` ∈ `createdAt, updatedAt, originalFilename, processingStatus`; `pageSize` ≤ 100 |
| `GET /documents/stats` | Counts for the dashboard |
| `GET /documents/{id}` | Metadata, status, attempts |
| `GET /documents/{id}/result` | Extraction (current + original), evidence, validation issues |
| `GET /documents/{id}/history` | Attempts, corrections, audit events |
| `GET /documents/{id}/download` | Original file as an attachment (`nosniff`, sandboxed CSP) |
| `PATCH /documents/{id}/corrections` (reviewer) | Body `{ expectedVersion, reason?, changes }` |
| `PATCH /documents/{id}/issues/{issueId}` (reviewer) | `{ resolution: "resolved" \| "waived" }` |
| `POST /documents/{id}/reprocess` | New attempt; `Idempotency-Key` replays; `202` |
| `GET /jobs/{attemptId}` | State of one processing attempt |
| `GET /search?q=&mode=keyword\|semantic` | Same filters as the list; `pageSize` ≤ 50 |
| `GET /capabilities` | `{ keywordSearch, semanticSearch, databaseProvider }` |
| `GET /health/live` · `GET /health/ready` | Probes (ready lists database, queue, storage, processor) |
| `GET /metrics` | Prometheus text; **404 unless `METRICS_TOKEN` is set**, bearer-protected |

## Examples

```bash
API=http://localhost:4000/api/v1

# sign in
TOKEN=$(curl -s $API/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"…"}' | jq -r .data.accessToken)

# upload two files; one is rejected per file, the batch continues
curl -s $API/documents -H "authorization: Bearer $TOKEN" -H 'Idempotency-Key: batch-2026-11-10-a' \
  -F files=@fixtures/synthetic/digital-01.pdf -F files=@malware.exe
```
```json
{ "success": true, "data": {
  "documents": [{ "id": "0b60fef5-…", "filename": "digital-01.pdf", "status": "queued", "replayed": false }],
  "rejected":  [{ "index": 1, "filename": "malware.exe", "code": "UNSUPPORTED_TYPE", "message": "Unsupported file type \".exe\". Allowed: PDF, JPG, PNG, TIFF, XLSX, XLS, CSV." }] } }
```

Result of `GET /documents/{id}/result` (abridged):

```json
{ "success": true, "data": {
  "document": { "id": "…", "processingStatus": "completed", "reviewStatus": "pending" },
  "result": {
    "version": 1,
    "extraction": {
      "schemaVersion": "1.0", "documentType": "invoice",
      "invoiceNumber": "INV-2026-0076", "invoiceDate": "2025-09-16",
      "supplierName": "IRONBRIDGE TOOLS LTD", "customerName": "Globex Corporation",
      "subtotal": "5684.34", "taxAmount": "284.22", "totalAmount": "5993.56", "currency": "USD",
      "lineItems": [{ "description": "Pallet wrap", "quantity": "3", "unitPrice": "156.32", "taxAmount": null, "lineTotal": "468.96" }],
      "fieldEvidence": { "invoiceNumber": { "sourcePage": 1, "sourceSheet": null, "sourceCell": null, "text": "Invoice No: INV-2026-0076" } },
      "fieldConfidence": { "invoiceNumber": null },
      "requiresManualReview": true
    },
    "original": { "…": "extraction exactly as first read; never edited" },
    "extractor": { "provider": "rules", "version": "1.0.0" }
  },
  "issues": [{ "id": "…", "code": "TOTAL_MISMATCH", "severity": "error",
    "message": "Subtotal + tax (5968.56) does not equal the total (5993.56).",
    "fields": ["subtotal", "taxAmount", "totalAmount"], "details": { "expected": "5968.56", "found": "5993.56", "difference": "25" }, "resolution": "open" }] } }
```

Money is always a decimal **string** (never a float). Dates are ISO `YYYY-MM-DD` only when unambiguous; otherwise the field is `null`, the source text is kept as evidence, and a `DATE_AMBIGUOUS` issue is raised. `fieldConfidence` is the OCR engine's mean word confidence when text was recognised, and `null` when the source had embedded text or cells (no meaningful value exists).

```bash
# correct a value (reviewer); stale `expectedVersion` → 409 CONCURRENT_MODIFICATION
curl -s -X PATCH $API/documents/$ID/corrections -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"expectedVersion":1,"reason":"typo","changes":{"totalAmount":"5968.56"}}'
```

Invalid corrections list every problem at once:

```json
{ "success": false, "code": "VALIDATION_FAILED", "errors": [
  { "code": "invalid_format", "field": "changes.totalAmount", "message": "Expected a decimal number such as 1234.50" },
  { "code": "invalid_format", "field": "changes.currency", "message": "Expected a 3-letter ISO 4217 code" } ] }
```

## Validation issue codes

`MISSING_REQUIRED · INVALID_DATE · DATE_AMBIGUOUS · DATE_SUSPICIOUS · INVALID_CURRENCY · INVALID_AMOUNT · NEGATIVE_AMOUNT · IMPLAUSIBLE_AMOUNT · TOTAL_MISMATCH · LINE_SUM_MISMATCH · LINE_ARITHMETIC_MISMATCH · LOW_CONFIDENCE_FIELD · DUPLICATE_INVOICE_CANDIDATE · DUPLICATE_FILE · CROSS_DOCUMENT_MISMATCH · CROSS_DOCUMENT_MATCH · MULTIPLE_INVOICES · MULTIPLE_RECORDS · NOT_AN_INVOICE`

Severity `error` / `warning` ⇒ `reviewStatus = pending`; `info` does not. Waived or resolved issues stop counting.

## Idempotency

`POST /documents` and `POST /documents/{id}/reprocess` honour `Idempotency-Key` (8–128 chars of `A–Z a–z 0–9 . _ : -`). A retry returns the original ids with `replayed: true` instead of creating duplicates.
