# Architecture Overview

```mermaid
flowchart TB
    U[Browser] --> W[Next.js Web]
    W --> A[NestJS REST API]
    A --> AUTH[Auth and RBAC]
    A --> DOC[Documents and Upload]
    A --> APP[Application Use Cases]
    APP --> REPO[Repository Port]
    REPO --> PG[(PostgreSQL)]
    REPO -. alternative .-> MG[(MongoDB)]
    REPO -. tests/dev .-> MEM[(In-memory)]
    APP --> OBJ[Object Storage Port]
    OBJ --> S3[(MinIO)]
    APP --> Q[Queue Port]
    Q --> RMQ[RabbitMQ]
    Q -. alternative .-> BQ[BullMQ]
    BQ --> REDIS[(Redis)]
    RMQ --> WORK[NestJS Worker]
    BQ --> WORK
    WORK --> PY[Python Processor]
    PY --> PDF[PDF Text and OCR]
    PY --> SHEET[Excel and CSV Parser]
    PDF --> TXT[Normalized Text + Coordinates]
    SHEET --> TXT
    TXT --> LLM[LLM Extraction Adapter]
    LLM --> VAL[Deterministic Validation]
    VAL --> REPO
    VAL --> IDX[Keyword and Vector Index]
    W --> SEARCH[Search and Review UI]
    SEARCH --> A
```

## Trust boundaries

1. Browser is untrusted; all inputs are validated server-side.
2. Uploaded documents are hostile data, not instructions.
3. Python processor runs isolated, with bounded CPU/memory/time and no public exposure.
4. LLM output is untrusted and schema-validated before persistence.
5. Infrastructure adapters are replaceable and selected at bootstrap.
6. Secrets are injected through environment/secret management, never source code.
