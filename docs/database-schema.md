# Database schema

PostgreSQL migrations (`apps/api/prisma/migrations`) are canonical. The MongoDB adapter stores the same logical records as documents (collections named after the models, indexes created on connect).

```mermaid
erDiagram
    USER ||--o{ DOCUMENT : uploads
    USER ||--o{ REFRESH_TOKEN : holds
    DOCUMENT ||--o{ PROCESSING_ATTEMPT : has
    DOCUMENT ||--o{ EXTRACTED_RESULT : produces
    DOCUMENT ||--o{ VALIDATION_ISSUE : raises
    DOCUMENT ||--o{ TEXT_CHUNK : indexes
    DOCUMENT ||--o{ CORRECTION : receives
    DOCUMENT ||--o{ AUDIT_EVENT : records
    OUTBOX_MESSAGE }o--|| DOCUMENT : "announces work for"

    USER { uuid id PK  string email UK  string password_hash  string role }
    REFRESH_TOKEN { uuid id PK  uuid user_id FK  string family_id  string token_hash UK  timestamptz expires_at  timestamptz revoked_at }
    DOCUMENT {
      uuid id PK  uuid owner_id FK  string original_filename  string detected_mime  bigint byte_size  string sha256
      string storage_key UK  string storage_provider  string document_type  string processing_status  string review_status
      string failure_code  string failure_message  string idempotency_key  timestamptz created_at  timestamptz updated_at  timestamptz deleted_at
    }
    PROCESSING_ATTEMPT { uuid id PK  uuid document_id FK  int attempt_number  string stage  string status  string error_code  bool retryable  timestamptz started_at  timestamptz finished_at }
    EXTRACTED_RESULT {
      uuid id PK  uuid document_id FK  uuid attempt_id  bool is_current  string schema_version
      string invoice_number  string invoice_number_key  string invoice_date  string supplier_name  string supplier_key  string customer_name
      decimal total_amount  string currency  jsonb raw  jsonb current  jsonb extractor  int version
    }
    VALIDATION_ISSUE { uuid id PK  uuid document_id FK  string code  string severity  string message  string[] fields  jsonb details  string resolution }
    TEXT_CHUNK { uuid id PK  uuid document_id FK  int chunk_index  int page  string sheet  string range  text content  vector_256 embedding  tsvector tsv }
    CORRECTION { uuid id PK  uuid document_id FK  uuid result_id  uuid actor_id  string field_path  jsonb previous_value  jsonb corrected_value  string reason }
    AUDIT_EVENT { uuid id PK  uuid document_id FK  uuid actor_id  string event_type  jsonb metadata }
    OUTBOX_MESSAGE { uuid id PK  string topic  jsonb payload  string status  int attempts  timestamptz available_at  string last_error  timestamptz sent_at }
```

## Design notes

- **Money** is `numeric(20,4)` for the filterable total and decimal **strings** inside the JSON (`raw`/`current`). No binary floating point anywhere in the money path (decimal.js, tolerance by ISO 4217 minor units).
- **Original vs corrected:** `raw` is the extraction exactly as first produced and is never updated; `current` holds `raw` plus human corrections. Every correction is also a row in `corrections` (who, which field, before/after, why). `version` provides optimistic concurrency.
- **Results are per attempt;** `is_current` marks the one the UI shows. Reprocessing never deletes earlier results or attempts.
- **Line items** are part of the result JSON (always read and edited together with their invoice). This differs from the earlier ERD sketch that proposed a table; it keeps corrections atomic.
- **Duplicate matching** uses the normalised `invoice_number_key` and `supplier_key` columns (lowercase alphanumerics) plus the `sha256` of the file for exact duplicates; both lookups are scoped to the owner.
- **Search:** `text_chunks.tsv` is a generated `tsvector` with a GIN index (keyword); `embedding` is `vector(256)` with an HNSW cosine index (semantic). Chunks keep `page`, or `sheet` + `range`, so results point at evidence.
- **Soft delete:** `documents.deleted_at` exists and every query filters it; no delete endpoint is exposed yet.
- **Outbox:** rows are written in the same transaction as the document and its first attempt (or a reprocess attempt) and drained by the relay with `FOR UPDATE SKIP LOCKED`.

## Indexes

`documents(processing_status, created_at)`, `documents(owner_id, created_at)`, `documents(sha256)`, unique `(owner_id, idempotency_key)`, unique `storage_key`; `extracted_results(document_id, is_current)`, `(invoice_number_key, supplier_key)`, `supplier_name`, `invoice_date`; `text_chunks(document_id, chunk_index)`, GIN on `tsv`, HNSW on `embedding`; `outbox_messages(status, available_at)`; unique `(document_id, attempt_number)`.

Prisma cannot express the `vector` extension, the generated `tsvector` column or the GIN/HNSW indexes, so they live in the hand-written migration `20261110000100_search_vectors`. `prisma migrate diff` therefore reports exactly those objects as "drift"; that is expected.
