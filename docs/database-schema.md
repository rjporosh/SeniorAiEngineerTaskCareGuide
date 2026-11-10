# Logical Database Schema

This is the provider-neutral logical model. PostgreSQL migrations are canonical; MongoDB documents/indexes must preserve these logical contracts. Refine physical types and constraints during implementation.

```mermaid
erDiagram
    USER ||--o{ DOCUMENT : uploads
    DOCUMENT ||--o{ PROCESSING_ATTEMPT : has
    DOCUMENT ||--o{ EXTRACTED_RESULT : produces
    EXTRACTED_RESULT ||--o{ LINE_ITEM : contains
    EXTRACTED_RESULT ||--o{ FIELD_EVIDENCE : cites
    DOCUMENT ||--o{ VALIDATION_ISSUE : raises
    DOCUMENT ||--o{ TEXT_CHUNK : indexes
    DOCUMENT ||--o{ CORRECTION : receives
    DOCUMENT ||--o{ AUDIT_EVENT : records
    DOCUMENT ||--o{ STORAGE_OBJECT : references

    USER {
      uuid id PK
      string email UK
      string password_hash
      string role
      datetime created_at
    }
    DOCUMENT {
      uuid id PK
      uuid owner_id FK
      string original_filename
      string detected_mime
      string document_type
      string processing_status
      string review_status
      string sha256
      datetime created_at
      datetime updated_at
    }
    STORAGE_OBJECT {
      uuid id PK
      uuid document_id FK
      string storage_key UK
      bigint byte_size
      string checksum
      string provider
    }
    PROCESSING_ATTEMPT {
      uuid id PK
      uuid document_id FK
      int attempt_number
      string stage
      string status
      string error_code
      datetime started_at
      datetime finished_at
    }
    EXTRACTED_RESULT {
      uuid id PK
      uuid document_id FK
      string schema_version
      string invoice_number
      date invoice_date
      string supplier_name
      string customer_name
      decimal subtotal
      decimal tax_amount
      decimal total_amount
      string currency
      json raw_structured_data
      boolean requires_manual_review
      datetime created_at
    }
    LINE_ITEM {
      uuid id PK
      uuid result_id FK
      string description
      decimal quantity
      decimal unit_price
      decimal tax_amount
      decimal line_total
    }
    FIELD_EVIDENCE {
      uuid id PK
      uuid result_id FK
      string field_path
      int source_page
      string source_sheet
      string source_cell
      text evidence_text
      decimal confidence
    }
    VALIDATION_ISSUE {
      uuid id PK
      uuid document_id FK
      string code
      string severity
      string message
      json details
      string resolution_status
      datetime created_at
    }
    TEXT_CHUNK {
      uuid id PK
      uuid document_id FK
      int chunk_index
      int source_page
      string source_sheet
      string source_range
      text content
      vector embedding
    }
    CORRECTION {
      uuid id PK
      uuid document_id FK
      uuid actor_id FK
      string field_path
      json previous_value
      json corrected_value
      string reason
      datetime created_at
    }
    AUDIT_EVENT {
      uuid id PK
      uuid document_id FK
      uuid actor_id FK
      string event_type
      json safe_metadata
      datetime created_at
    }
```

## Important constraints and indexes

- Unique storage key; unique document hash may be used for exact duplicate upload detection without assuming business-level duplicate invoice.
- Index `documents(processing_status, created_at)`.
- Index invoice normalized number and supplier/date for duplicate candidates.
- Index invoice date, supplier, currency and total for filters.
- Full-text index on searchable extracted text and invoice metadata.
- pgvector index selected based on vector dimension and measured dataset size.
- Foreign keys and transactions for PostgreSQL.
- Use decimal/numeric for financial values.
- Preserve immutable processing attempts and corrections.
- Keep large binary content in object storage, not database rows.
