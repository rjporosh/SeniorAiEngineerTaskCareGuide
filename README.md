# Document Intelligence — Claude implementation pack

This pack contains the project brief and Claude Code operating instructions for the five-day **AI-Powered Document Intelligence System** assignment.

## Included

- `CLAUDE.md` — primary Claude Code project instructions.
- `.claude/settings.json` — conservative local permissions baseline; no blanket command approvals.
- `.gitignore` — explicitly ignores `ai-handover.md`, environment secrets and runtime data.
- `docs/MASTER_SPECIFICATION.md` — requirements, architecture, security and definition of done.
- `docs/ROADMAP.md` — five-day delivery sequence and exit gates.
- `docs/PLAN.md` — repository layout, ports/adapters, service contracts, tests and Compose requirements.
- `ai-handover.md` — local AI working notes; must never be committed.

## Start using this pack

1. Extract/copy these files into the root of the project repository.
2. Open the repository with Claude Code.
3. Ask Claude to inspect the repository, read `CLAUDE.md` and the three docs, then execute Day 1 only.
4. Review the proposed architecture and file tree before authorizing broad implementation.
5. Keep `ai-handover.md` local. Verify:
   ```bash
   git check-ignore -v ai-handover.md
   ```

## Important implementation note

The brief asks for the latest technologies. Claude must verify exact stable patch versions and compatibility at implementation time, then pin them in manifests and lockfiles. Do not use prerelease/canary versions merely because they have a larger version number.

The default local configuration should be PostgreSQL + RabbitMQ + MinIO. MongoDB, Redis/BullMQ and in-memory adapters are selectable by environment configuration. In-memory storage is for tests/development only.

## Source assignment

The project scope is based on the supplied `Ai Engineer Task 1.3.pdf`. The pack preserves its seven task areas and nine deliverables while adding explicit architecture, security, reliability and execution criteria.

## Quick start (foundation milestone)

```bash
cp .env.example .env          # then replace every CHANGE_ME value (openssl rand -hex 32)
docker compose up --build     # postgres(pgvector), rabbitmq, minio, api
curl localhost:4000/api/v1/health/ready
```

Optional provider containers: `docker compose --profile mongodb up` (MongoDB), `--profile bullmq` (Redis).
Host port of the API is `API_PUBLIC_PORT` (default 4000). Database/broker ports are not published.

## Pinned versions (checked against the npm registry on 2026-11-10)

Node 24 LTS image, NestJS 12.4.2, Zod 4.6.7, TypeScript 7.0.2, Vitest 5.1.0, pnpm 12.18.0,
PostgreSQL 18 (pgvector image), RabbitMQ 4.1. Prisma CLI is pinned to the stable 7.10.1 line
because the registry `latest` tag currently points at an 8.0 release candidate.

## Known limitations

- MinIO no longer publishes an official pullable image; Compose uses the frozen
  `bitnamilegacy/minio` pinned tag. Use `OBJECT_STORAGE_PROVIDER=local` or your own S3 for production.
