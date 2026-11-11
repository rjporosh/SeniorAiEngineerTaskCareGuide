# AI assistance disclosure

This project was built with an AI coding assistant (Claude Code) working from `docs/MASTER_SPECIFICATION.md`, `docs/ROADMAP.md` and `docs/PLAN.md` under the owner's direction.

## What the assistant did

Wrote the application, tests, Docker/Compose files, scripts and documentation; ran every build, test, container and browser check reported in this repository; fixed the defects those checks found (for example the concurrent-duplicate race, amount-parsing and date roll-over bugs, rate-limit/idempotency ordering, and test-database pollution).

## What the product itself uses

The default extractor (`EXTRACTOR_PROVIDER=rules`) is deterministic and uses no model. Setting `EXTRACTOR_PROVIDER=ollama` (default model `qwen2.5-coder:14b`, local) or `openai` makes a language model *propose* invoice fields.

- **Prompt:** the system prompt and JSON schema are in `apps/api/src/extraction/llm/prompt.ts`, versioned as `PROMPT_VERSION` (currently `invoice-extraction/2026-11-11.1`). The document text is the only user content, wrapped in `<document>` tags and declared untrusted.
- **Recorded per extraction:** provider, model name and prompt version are stored with every result (`extracted_results.extractor`); the timestamps are the result's `createdAt`.
- **Safeguards:** schema-constrained decoding plus strict zod validation, grounding of every value in the source text, deterministic amount/date normalisation, rules cross-check, null for anything unsupported. The model has no tools and its output is never executed.

## Human responsibilities that remain

- Review the code, the security notes and the limitations before relying on this system.
- Evaluate on your own authorised documents: the bundled dataset is synthetic and written by the same author as the extractor.
- Decide data-retention, encryption-at-rest and hosting policy.

## Prompts

The working instructions are the repository's `CLAUDE.md` and the three specification documents. The conversation history is not part of the deliverable.
