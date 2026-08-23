# Raise

**An AI-assisted fundraising workspace for startup teams.**

Founders manage investors and rounds, run a deal pipeline, collaborate in team
chat, keep a versioned document vault, share controlled data-room links with
external reviewers, and use an AI copilot grounded in their own workspace data —
with per-workspace roles and a full audit trail behind all of it.

A private TypeScript monorepo containing the web app, REST API, scheduled jobs,
and BullMQ workers.

---

## Quick start

```bash
cp packages/api/.env.example packages/api/.env   # first — Prisma postinstall reads it
npm install
docker compose up -d                             # postgres :5433, redis :6379, worker
npm run db:migrate --workspace=@raise/api
npm run db:seed    --workspace=@raise/api        # destructive: disposable DB only
npm run dev
```

| | |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:3000 |
| API docs (Swagger) | http://localhost:3000/api/docs |
| Demo sign-in | `muhamad.houda@gmail.com` / `Founder1234!` |

Requires Node 22.13+, npm 10+, and Docker. Full walkthrough, prerequisites, and
what runs without third-party credentials:
**[docs/getting-started.md](docs/getting-started.md)**.

## Documentation

**→ [docs/README.md](docs/README.md) is the documentation index.** Start there.

The pages you are most likely to want:

| | |
|---|---|
| [Feature guide](docs/features.md) | What the product does, module by module |
| [Architecture](docs/architecture.md) | Components, boundaries, and data flows |
| [Backend guide](docs/backend.md) | API layering and the recipe for a new resource |
| [Frontend guide](docs/frontend.md) | Routing, state ownership, and UI conventions |
| [API reference](docs/api-reference.md) | Every endpoint with its permission |
| [Data model](docs/data-model.md) | Schema domains, invariants, migrations |
| [Security model](docs/security.md) | Sessions, RBAC, tenancy, abuse controls |
| [Configuration](docs/configuration.md) | Every environment variable |
| [Operations](docs/operations.md) | Deploy, monitor, and respond to incidents |
| [Contributing](docs/contributing.md) | Workflow, conventions, review checklist |
| [Troubleshooting](docs/troubleshooting.md) | Known failure modes and fixes |

Also: [`packages/api/openapi.yaml`](packages/api/openapi.yaml) is the REST
contract of record, and [`AGENTS.md`](AGENTS.md) is the condensed brief for AI
coding agents.

## Technology

| Area | Technology |
|---|---|
| Web | React 19, Vite, React Router, TanStack Query, Zustand, Tailwind CSS 4, Radix |
| API | Express 5, Prisma 7, PostgreSQL 16 with pgvector, Zod |
| Auth | HttpOnly JWT access/refresh cookies, email OTP, Google sign-in |
| Async work | BullMQ workers on Redis, node-cron schedules |
| Realtime | Server-sent events with Redis Pub/Sub fan-out |
| Integrations | Resend, Google Calendar/Gmail, Supabase Storage, LlamaParse, OpenAI |
| Monorepo | npm workspaces + Turborepo |

## Repository layout

```text
.
├── packages/
│   ├── api/                 Express API, Prisma, cron, and workers
│   │   ├── prisma/          Schema, migrations, development seed
│   │   ├── src/             config, routes, controllers, services, jobs, middleware
│   │   ├── tests/           Jest suites
│   │   └── openapi.yaml     REST contract of record
│   └── web/                 React application
│       └── src/             pages, components, hooks, lib, routes
├── docs/                    All project documentation
├── docker-compose.yml       PostgreSQL, Redis, and the worker
├── Dockerfile.worker        Worker image (includes LibreOffice)
└── turbo.json               Monorepo task configuration
```

Background jobs live in `packages/api/src/jobs`. There is no separate `workers`
or `shared` workspace.

## Commands

Run from the repository root.

| Command | Purpose |
|---|---|
| `npm run dev` | API and web development servers |
| `npm run worker` | Host worker in watch mode |
| `npm run build` | Type-check and build both workspaces |
| `npm run test` | API Jest and web Vitest suites |
| `npm run lint` | Lint both workspaces |
| `npm run ci` | Lint, test, and build — the gate CI runs |
| `npm run db:migrate --workspace=@raise/api` | Apply committed migrations |
| `npm run db:migrate:dev --workspace=@raise/api` | Create a development migration |
| `npm run db:seed --workspace=@raise/api` | Rebuild demo data (**destructive**) |
| `npm run db:studio --workspace=@raise/api` | Prisma Studio |
| `npm run gen:api-types --workspace=@raise/web` | Regenerate frontend types from OpenAPI |

`db:seed` and `db:reset` delete every application row. Use them only against a
disposable local database.

## Before you merge

```bash
npm run ci
```

Plus, depending on what changed:

- **Database change** → commit the Prisma migration with the schema edit.
- **API change** → update `openapi.yaml` and regenerate the frontend types in
  the same change.
- **Any change** → update the matching page under `docs/`. The table in
  [docs/contributing.md](docs/contributing.md#keeping-documentation-true) says
  which one.
