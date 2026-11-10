# Security

Uploaded files, filenames, MIME headers and extracted text are all treated as hostile input. This page lists what is implemented and where it is tested. Nothing here is a claim of certification; see "Not covered".

## Controls

| Threat | Control | Tested in |
|---|---|---|
| Disguised/malicious upload | Extension allow-list **and** declared-MIME match **and** magic-byte signature; CSV must be valid UTF-8 text; real type is re-sniffed by the processor | `domain/file-types.spec.ts`, `documents.api.spec.ts`, processor `test_executable_masquerading…` |
| Path traversal / filename abuse | Client filename is display-only (basename, control characters stripped, 200 chars). Storage keys are generated (`yyyy/mm/uuid`) and validated again by every storage adapter | `file-types.spec.ts`, API test with `../../x"y.pdf` |
| Oversize, decompression and parser bombs | Per-file and per-batch byte limits enforced while streaming; page, pixel, TIFF-frame, row, cell, sheet, text, zip-ratio and wall-clock limits in the processor | `documents.api.spec.ts`, processor tests (zip bomb, page limit, pixel limit, row limit, 1000 pages) |
| Macros, formulas, XXE | `openpyxl` read-only with cached values; macros reported but never run; formulas never evaluated; CSV/XLSX formula text is returned as inert text; `defusedxml` installed | processor tests |
| SSRF | Nothing fetches URLs from documents; the processor only listens, and the API only calls the configured processor URL | by design |
| Prompt injection | No LLM is used. Document text is data: there is a regression fixture proving that "ignore all previous instructions…" cannot change extraction | `rules-extractor.spec.ts`, evaluation set (`edge-injection.pdf`) |
| Credential theft | Argon2id (OWASP parameters), 15-minute access tokens, opaque refresh tokens stored as SHA-256, rotation with **reuse detection** (reuse revokes the whole token family), identical errors and timing for unknown user vs wrong password | `auth.service.spec.ts` |
| Brute force / abuse | Global per-IP rate limit and a much stricter login/refresh limit (HTTP 429, `RATE_LIMITED`) | k6 `ratelimit.js`, Playwright global setup |
| Broken access control | Global auth guard (deny by default), role guards, per-document ownership checks; other users' documents answer `404` | `documents.api.spec.ts`, `review.api.spec.ts` |
| XSS | The API never returns HTML (search snippets are plain text); the UI renders text nodes only; CSP `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`; downloads are `attachment` + `nosniff` + sandboxed CSP | `review.api.spec.ts`, UI tests |
| CSRF | Tokens are never in JavaScript: HttpOnly, SameSite=Lax cookies + same-origin check + required `X-Requested-With` header on every mutation | Playwright, curl in the build log |
| Session leakage | Refresh cookie is scoped to `/api`; sign-out revokes the token family; `Secure` cookies when `COOKIE_SECURE=true` | |
| Information leakage | One exception filter returns generic messages for unexpected errors; logs and responses never contain stack traces, SQL or connection strings | `errors.spec.ts` |
| Secrets in logs | Redaction of bearer tokens, JWTs, `password/token/secret/api_key` pairs and connection-string passwords; access logs omit query strings; raw OCR text and invoice content are never logged | `observability/metrics.spec.ts` |
| Misconfiguration | Strict start-up validation (unknown providers, short secrets, missing provider settings); the in-memory database is refused when `NODE_ENV=production` | `env.schema.spec.ts` |
| Container breakout | Non-root users, pinned images, `read_only` root filesystem and `cap_drop: ALL` for the processor and web, no host ports for databases or the processor, private network | `docker compose config` |
| Supply chain | Lockfiles, `--frozen-lockfile`, dependency build scripts disabled unless allow-listed, CI `pnpm audit` and image scan | `.github/workflows/ci.yml` |

## Data handling

- File bytes live only in object storage; the database stores metadata and an opaque key. Storage paths and keys are never returned to clients.
- Every download, correction, issue resolution and reprocess is written to the audit log with the actor.
- Duplicate detection and cross-document comparison are scoped to the same owner, so one user can never learn about another user's invoices.
- Encryption in transit is a deployment responsibility (terminate TLS at a reverse proxy and set `COOKIE_SECURE=true`, `TRUST_PROXY=true`). **Encryption at rest is not configured or claimed**; enable volume/bucket encryption in your environment.

## Hardening checklist before exposing it

1. Replace every `CHANGE_ME`; remove `SEED_ADMIN_*` after the first start.
2. Serve over HTTPS; set `COOKIE_SECURE=true` and `TRUST_PROXY=true` behind your proxy.
3. Keep `API_DOCS_ENABLED=false` and `METRICS_TOKEN` unset or secret.
4. Do not publish database, broker, MinIO or processor ports (the default compose file does not).
5. Back up the database and the bucket; define retention for uploaded documents.

## Not covered

No third-party penetration test, malware scanning/quarantine of uploads, multi-tenancy, SSO/MFA, or field-level encryption has been done. Extraction accuracy is not a security property: always review flagged documents.
