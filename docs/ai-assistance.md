# AI assistance disclosure

This project was built with an AI coding assistant (Claude Code) working from `docs/MASTER_SPECIFICATION.md`, `docs/ROADMAP.md` and `docs/PLAN.md` under the owner's direction.

## What the assistant did

Wrote the application, tests, Docker/Compose files, scripts and documentation; ran every build, test, container and browser check reported in this repository; fixed the defects those checks found (for example the concurrent-duplicate race, amount-parsing and date roll-over bugs, rate-limit/idempotency ordering, and test-database pollution).

## What the product itself uses

**No AI model is used at runtime.** Extraction is deterministic and rule-based, so there is no prompt, model, provider or model version to record. `InvoiceExtractorPort` is the seam where a model-backed extractor could be added; if one is, store provider, model, prompt version and timestamps as the specification requires.

## Human responsibilities that remain

- Review the code, the security notes and the limitations before relying on this system.
- Evaluate on your own authorised documents: the bundled dataset is synthetic and written by the same author as the extractor.
- Decide data-retention, encryption-at-rest and hosting policy.

## Prompts

The working instructions are the repository's `CLAUDE.md` and the three specification documents. The conversation history is not part of the deliverable.
