# Deploying a free demo

Goal: a link a recruiter can open, sign in with a demo account, and try the product. **This is for demonstrations only**: free tiers sleep, files live on ephemeral disk, and the demo account can see everything uploaded to the demo. Never upload real documents to it.

> **Status:** I could not publish this for you: no hosting account is connected to this repository's machine, so no live URL exists yet. The configuration below was validated as far as possible without an account: `render.yaml` against Render's published JSON schema (0 errors), the images with `docker compose`, and the platform-style addressing (`processor:8000`, `api:3001`) end to end with `scripts/check-deployment.mjs`. When you deploy, run that script against your URL; it is the proof.

## Demo account

| | |
|---|---|
| Email | `demo@docint.example` |
| Password | `Recruiter-Demo-2026` |
| Role | reviewer: can upload, search, correct values, resolve issues and reprocess; cannot create users |

This credential is public on purpose and only meaningful on a deployment that sets `SEED_DEMO_EMAIL` / `SEED_DEMO_PASSWORD` to it (the Blueprint does). Do not reuse it anywhere else. For a longer-lived demo, change the password in the host's environment settings and in the README.

## Option A: everything on Render (one click, free)

1. Make the GitHub repository **public** (Render's deploy button needs it) and push.
2. Open `https://render.com/deploy?repo=https://github.com/<you>/<repo>` and approve the Blueprint (`render.yaml`). It creates: `docint-web`, `docint-api` (also runs the worker and applies migrations on start), `docint-processor` (Tesseract OCR), a free PostgreSQL database with pgvector, and a free Key Value (Redis) instance used by BullMQ.
3. Wait for the four services to go *Live* (the first build takes several minutes). Your demo URL is the `docint-web` service URL.
4. Verify: `node scripts/check-deployment.mjs --web https://<docint-web>.onrender.com --email demo@docint.example --password 'Recruiter-Demo-2026'` (the first request may take about a minute while free instances wake up).
5. Put the URL in the README "Live demo" line.

How the Blueprint maps to the Compose stack:

| Compose | Render |
|---|---|
| PostgreSQL | managed free PostgreSQL (`DATABASE_URL` wired automatically) |
| RabbitMQ | replaced by BullMQ on managed Key Value (`QUEUE_PROVIDER=bullmq`); no code change |
| MinIO | `OBJECT_STORAGE_PROVIDER=local` on ephemeral disk (documents vanish on restart) |
| processor | free web service protected by a shared `PROCESSOR_SERVICE_TOKEN`; the API reaches it over Render's private network (`hostport`) |
| secrets | generated once in the `docint-shared-secrets` group |

Known free-tier effects: services spin down after about 15 minutes idle; 512 MB RAM is enough for small demo documents but not for large scans; the free database has a limited lifetime; the processor is publicly reachable (free private services do not exist) but rejects calls without the service token. The Blueprint lowers `MAX_FILE_SIZE_MB` to 10.

## Option B: web on Vercel, backend on a container host

Vercel can host only the Next.js app. It still needs the API, processor, database and queue running somewhere reachable, for example Option A's `docint-api` (or Northflank/Fly/Railway with the same images).

1. Deploy the backend (API + processor + PostgreSQL + Redis/RabbitMQ) and note the public API base URL, e.g. `https://docint-api.onrender.com`.
2. In Vercel: **Add New → Project**, import the repository, set **Root Directory** to `apps/web` and enable *Include source files outside of the Root Directory*. `apps/web/vercel.json` sets the install/build commands.
3. Environment variables for the project: `API_INTERNAL_URL=https://<public API host>/api/v1`, `COOKIE_SECURE=true`.
4. Deploy, then run `scripts/check-deployment.mjs` against the Vercel URL.

Limits to know: Vercel serverless functions accept request bodies up to about 4.5 MB, so uploads through the BFF are limited to small files (the demo fixtures are small); long uploads are better served by Option A. The API sees every request coming from Vercel, so rate limiting by IP is shared unless the BFF forwards the client address (the login route already does; set `TRUST_PROXY=true` on the API).

Continuous delivery to Vercel: `.github/workflows/ci.yml` contains a `deploy-web` job that runs after the tests pass on `main`, **only** when the repository variable `VERCEL_DEPLOY` is `true` and the secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` exist. It has not been exercised because no Vercel account was available. Render redeploys automatically on every push to the tracked branch.

## Option C: Northflank (or any Docker host)

Create a project with: a PostgreSQL addon (pgvector enabled) and a Redis addon (or an external CloudAMQP RabbitMQ); a service built from `apps/api/Dockerfile` (build context = repository root, port 3001, command `sh -c "node migrate.mjs && node --import ./dist/instrumentation.js dist/main.js"`); a service from `services/document-processor/Dockerfile` (target `runtime`, port 8000, private); and a service from `apps/web/Dockerfile` (port 3000, public). Use the same environment variables as `render.yaml`. Free sandbox limits (services, memory) may be too small for OCR; check the plan before choosing it.

## Environment reference (hosted)

| Service | Variable | Value |
|---|---|---|
| API | `DATABASE_PROVIDER`, `DATABASE_URL` | `postgres`, connection string (needs the `vector` extension; migrations create it) |
| API | `QUEUE_PROVIDER`, `REDIS_URL` / `RABBITMQ_URL` | `bullmq` + Redis URL, or `rabbitmq` + AMQP URL |
| API | `OBJECT_STORAGE_PROVIDER` | `local` (demo) or `minio` with `S3_*` pointing at any S3-compatible bucket |
| API | `PROCESSOR_BASE_URL`, `PROCESSOR_SERVICE_TOKEN` | processor address (bare `host:port` is accepted) and the shared token |
| API | `JWT_ACCESS_SECRET` | 32+ random characters |
| API | `SEED_DEMO_EMAIL`, `SEED_DEMO_PASSWORD` | the demo account (optional) |
| API | `TRUST_PROXY` | `true` behind a proxy |
| Processor | `PROCESSOR_SERVICE_TOKEN` | same token as the API |
| Web | `API_INTERNAL_URL` | API address (bare `host:port` or full URL; `/api/v1` is added if missing) |
| Web | `COOKIE_SECURE` | `true` over HTTPS |

## Container images (GitHub Container Registry)

`.github/workflows/publish.yml` builds `docint-web`, `docint-api` and `docint-processor` for `linux/amd64` and `linux/arm64` and pushes them to `ghcr.io/<owner>/` after CI succeeds on `main` (tags: `latest`, short SHA, and `vX.Y.Z` for version tags). It needs no secrets beyond the built-in `GITHUB_TOKEN`.

| Image | Reference |
|---|---|
| Web UI | `ghcr.io/rjporosh/docint-web:latest` |
| API | `ghcr.io/rjporosh/docint-api:latest` |
| Processor | `ghcr.io/rjporosh/docint-processor:latest` |

- First publish creates private packages: open each package on GitHub → *Package settings* → *Change visibility* → Public so anyone can `docker pull` them.
- Run everything from the images: `docker compose -f compose.yaml -f compose.images.yaml up -d --wait`, then open **http://localhost:4001** (UI) and **http://localhost:4000/api/docs** (API reference).
- The web image has no API address baked in: set `API_INTERNAL_URL` (compose does) so one image works anywhere.
- Ollama is not containerised here; the API reaches an Ollama on the host (`host.docker.internal`). On a host without Ollama use `EXTRACTOR_PROVIDER=rules` or `openai`.

## CI/CD summary

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push to `main`, pull requests | typecheck, lint, API/UI/processor tests, adapter contracts, Docker stack + smoke + Playwright + evaluation, dependency audit, image build + Trivy scan |
| `publish.yml` | CI succeeded on `main`, `v*` tags, manual | multi-arch images → GHCR |
| `ci.yml` › `deploy-web` | `main` and repository variable `VERCEL_DEPLOY=true` | optional Vercel deployment of the web app (needs `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) |
