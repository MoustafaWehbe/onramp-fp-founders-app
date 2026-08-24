# Getting started

How to get Raise running on a development machine, what the seed data contains,
and the commands you will use every day.

> Setting up to make a change rather than just to run it? Read
> [architecture.md](architecture.md) next, then the guide for the layer you are
> touching — [backend.md](backend.md) or [frontend.md](frontend.md).

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22.13 or newer | `pdfjs-dist` 6 uses Node APIs added in 22.13. On Node 20 rasterized page text renders blank with no error. |
| npm | 10 or newer | Workspaces and the committed `package-lock.json`. |
| Docker + Compose | current | PostgreSQL with pgvector, Redis, and the worker image. |

Everything else is installed by `npm install`.

## Setup

### 1. Create the API environment file

```bash
cp packages/api/.env.example packages/api/.env
```

```powershell
Copy-Item packages/api/.env.example packages/api/.env
```

**Do this before `npm install`.** The API's `postinstall` runs
`prisma generate`, which loads `prisma.config.ts`, which reads `DATABASE_URL`
from this file.

The checked-in defaults point at PostgreSQL on host port `5433` and Redis on
`6379` — the ports `docker-compose.yml` publishes. You only need to fill in
provider credentials for the optional features you actually want to exercise;
see [configuration.md](configuration.md) for what each group unlocks.

### 2. Install dependencies

```bash
npm install
```

### 3. Start infrastructure

```bash
docker compose up -d
```

| Service | Host port | Purpose |
|---|---:|---|
| `postgres` (`pgvector/pgvector:pg16`) | 5433 | Primary persistence and vector search |
| `redis` (`redis:7-alpine`) | 6379 | Queues (including scheduled tasks), rate limits, realtime pub/sub |
| `worker` (built from `Dockerfile.worker`) | — | BullMQ jobs, including LibreOffice conversion |

The `worker` service reads `packages/api/.env` and overrides the host-oriented
`DATABASE_URL`/`REDIS_URL` with in-network service names.

> **Run one worker, not two.** `docker compose up` already starts a worker. If
> you also run `npm run worker` on the host, both processes consume the same
> Redis queues and jobs are split unpredictably between them. Use the Docker
> worker when you need DOCX/PPTX conversion (only that image has LibreOffice),
> and the host worker when you want watch-mode reloads — never both.

### 4. Apply migrations and seed

```bash
npm run db:migrate --workspace=@raise/api
npm run db:seed --workspace=@raise/api
```

> **`db:seed` is destructive.** It deletes every application row before
> rebuilding the demo dataset. Point it only at a disposable local database.

### 5. Run the app

```bash
npm run dev
```

| Endpoint | URL |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:3000 |
| Swagger UI | http://localhost:3000/api/docs |
| Raw OpenAPI | http://localhost:3000/api/openapi.yaml |
| Liveness | http://localhost:3000/health |
| Readiness | http://localhost:3000/ready |

Vite proxies `/api` to port 3000, so the browser sees one origin. That is what
keeps HttpOnly cookie auth and SSE working without CORS exceptions in
development — preserve the same-origin arrangement in production, or configure
`CORS_ORIGIN` and cookie attributes to match your real topology.

## Demo data

The seed is deterministic: the same input always produces the same workspaces,
investors, deals, documents, and chat history.

| Item | Value |
|---|---|
| Primary workspace | **Northbeam** |
| Second workspace | **Drift Labs** |
| Owner account | `muhamad.houda@gmail.com` |
| Shared password | `Founder1234!` |

Other seeded members exist with the same password, plus one Google-provider
account with no password (`rana@northbeam.io`) that exercises the "this account
signs in with Google" branch of the login route. Investor records use
`*.example.com` addresses so nothing can reach a real mailbox.

These are development fixtures. They must never be used as production
credentials, and the seed must never run against a database you care about.

## Everyday commands

Run from the repository root; Turborepo fans them out to both workspaces.

| Command | What it does |
|---|---|
| `npm run dev` | API (`tsx watch`) + web (Vite) in parallel |
| `npm run worker` | Host worker in watch mode (see the warning above) |
| `npm run build` | Type-check and build both packages |
| `npm run test` | API Jest suite + web Vitest suite, both with coverage |
| `npm run lint` | ESLint across both packages |
| `npm run ci` | `lint` → `test` → `build`; mirrors GitHub Actions |
| `npm run clean` | Remove build output and `node_modules` |

Workspace-scoped commands:

| Command | What it does |
|---|---|
| `npm run db:migrate --workspace=@raise/api` | Apply committed migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev --workspace=@raise/api` | Create and apply a new development migration |
| `npm run db:seed --workspace=@raise/api` | Rebuild demo data (**destructive**) |
| `npm run db:reset --workspace=@raise/api` | Drop, re-migrate, re-seed (**destructive**) |
| `npm run db:studio --workspace=@raise/api` | Prisma Studio |
| `npm run db:backfill-pages --workspace=@raise/api` | Rasterize page images for versions that predate the feature |
| `npm run eval:ai --workspace=@raise/api` | Run the offline AI evaluation harness |
| `npm run gen:api-types --workspace=@raise/web` | Regenerate `src/lib/api-types.ts` from `openapi.yaml` |

## Running without the optional providers

Raise starts and most of the product works with no third-party credentials at
all. What degrades:

| Unset | Effect |
|---|---|
| `RESEND_API_KEY` | Outgoing email (invites, OTP, reviewer links, password reset) is not delivered. Required in production. |
| `SUPABASE_*` | Uploads fall back to `packages/api/.uploads` with Redis-gated upload/download tokens. Fine locally, not for production. |
| `LLAMA_CLOUD_API_KEY` | Only `text/plain` uploads parse. Everything else fails the version with `PARSE_UNAVAILABLE`. |
| `OPENAI_API_KEY` | Document versions still reach `ready`, but chunks get no embeddings, so semantic retrieval finds nothing. |
| `AI_ENABLED=false` | AI chat and analysis endpoints return a disabled error. |
| Google integration vars | Calendar sync and Gmail send are hidden. Sign-in with Google still works — it needs only `GOOGLE_CLIENT_ID`. |

The API validates configuration at boot and exits with a list of problems
rather than failing later inside a user request. Partially configured groups
(for example three Google integration variables where one is missing) are
treated as errors on purpose.

## Next steps

- [Architecture](architecture.md) — how the pieces fit together.
- [Feature guide](features.md) — what to click once you are signed in.
- [Troubleshooting](troubleshooting.md) — if something above did not work.
