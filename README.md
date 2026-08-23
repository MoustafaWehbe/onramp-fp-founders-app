# Raise

Raise is an AI-assisted fundraising workspace for startup teams. Founders can
manage investors and fundraising rounds, run a deal pipeline, collaborate in
team chat, maintain a versioned document vault, share controlled reviewer
links, and use an AI copilot over authorized workspace data.

This repository is a private TypeScript monorepo containing the web app, REST
API, scheduled jobs, and BullMQ workers.

## Documentation

- [Architecture](docs/architecture.md) — components, boundaries, data flows,
  security model, and engineering conventions.
- [Reviewer operations](docs/reviewer-operations.md) — reviewer metrics,
  retention, and recommended alerts.
- [OpenAPI contract](packages/api/openapi.yaml) — API contract of record; also
  served locally through Swagger UI at `http://localhost:3000/api/docs`.
- [Agent guidance](AGENTS.md) — repository-specific instructions for coding
  agents.

## Technology

| Area | Technology |
|---|---|
| Web | React, Vite, React Router, TanStack Query, Zustand, Tailwind CSS, Radix UI |
| API | Express, Prisma, PostgreSQL with pgvector, Zod |
| Authentication | HttpOnly JWT access/refresh cookies, email OTP, Google sign-in |
| Async work | BullMQ workers and Redis |
| Realtime | Server-sent events with Redis Pub/Sub fan-out |
| Integrations | Resend, Google Calendar/Gmail, Supabase Storage, LlamaParse, OpenAI |
| Monorepo | npm workspaces and Turborepo |
| Language | TypeScript |

## Repository layout

```text
.
├── packages/
│   ├── api/                 Express API, Prisma schema, cron, and workers
│   │   ├── prisma/          Schema, migrations, and development seed
│   │   ├── src/             API application code
│   │   ├── tests/           Jest tests
│   │   └── openapi.yaml     REST API contract
│   └── web/                 React application
│       └── src/             Pages, components, hooks, and API clients
├── docs/                    Architecture and operational runbooks
├── docker-compose.yml       PostgreSQL, Redis, and worker services
├── Dockerfile.worker        Production worker image with LibreOffice
└── turbo.json               Monorepo task configuration
```

Background jobs are part of `packages/api`; there are no separate `workers`
or `shared` workspaces.

## Local development

### Prerequisites

- Node.js 22.13 or newer
- npm 10 or newer
- Docker with Docker Compose

### 1. Create the API environment file

macOS/Linux:

```bash
cp packages/api/.env.example packages/api/.env
```

PowerShell:

```powershell
Copy-Item packages/api/.env.example packages/api/.env
```

The checked-in development defaults connect to PostgreSQL on host port `5433`
and Redis on `6379`. Replace placeholder secrets and configure optional
providers only when exercising those features. The API validates required and
partially configured feature settings at startup.

Create this file before installing dependencies because the API postinstall
loads Prisma configuration and generates the client.

### 2. Install dependencies

```bash
npm install
```

### 3. Start infrastructure

```bash
docker compose up -d
```

This starts:

| Service | Host port | Purpose |
|---|---:|---|
| PostgreSQL with pgvector | 5433 | Primary persistence and vector search |
| Redis | 6379 | Queues, rate limiting, cron locks, and realtime fan-out |
| Worker | none | Email, documents, embeddings, AI analysis, and sync jobs |

The Docker worker includes LibreOffice for DOCX/PPTX conversion. Do not also
run the host worker against the same Redis instance unless you intentionally
want multiple consumers.

### 4. Apply migrations and seed development data

```bash
npm run db:migrate --workspace=@raise/api
npm run db:seed --workspace=@raise/api
```

> **Warning:** `db:seed` deletes all application rows before rebuilding the
> deterministic demo dataset. Run it only against a disposable local database.

The seed is deterministic and creates the Northbeam and Drift Labs example
workspaces. Seeded local accounts use the password `Founder1234!`; for example,
`muhamad.houda@gmail.com` is the Northbeam owner. These are development-only
fixtures and must never be used as production credentials.

If an older Docker volume was created with a different database name, keep its
matching `DATABASE_URL` or deliberately recreate/migrate that volume. Do not
assume reseeding changes the database selected by PostgreSQL.

### 5. Start the web app and API

```bash
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- API documentation: `http://localhost:3000/api/docs`
- Liveness: `http://localhost:3000/health`
- Dependency readiness: `http://localhost:3000/ready`

Vite proxies `/api` to the API, keeping cookie authentication and SSE on the
same browser origin during development.

## Commands

Run commands from the repository root unless noted otherwise.

| Command | Purpose |
|---|---|
| `npm run dev` | Start API and web development servers |
| `npm run worker` | Start API workers on the host in watch mode |
| `npm run build` | Type-check and build all workspaces |
| `npm run test` | Run API Jest and web Vitest suites |
| `npm run lint` | Lint all workspaces |
| `npm run ci` | Run lint, tests, and build |
| `npm run db:migrate --workspace=@raise/api` | Apply committed Prisma migrations |
| `npm run db:migrate:dev --workspace=@raise/api` | Create/apply a development migration |
| `npm run db:seed --workspace=@raise/api` | Seed deterministic development data |
| `npm run db:studio --workspace=@raise/api` | Open Prisma Studio |
| `npm run gen:api-types --workspace=@raise/web` | Regenerate frontend OpenAPI types |

`db:seed` and `db:reset` are destructive and should only be used against a
disposable local database.

## Configuration

The canonical API variable reference is
[`packages/api/.env.example`](packages/api/.env.example). Major groups are:

- application URLs, proxy trust, logging, and metrics;
- PostgreSQL and Redis;
- JWT, OTP, and reviewer-page signing secrets;
- email delivery through Resend;
- private documents and public avatars through Supabase Storage;
- LlamaParse and OpenAI document/AI processing;
- optional Google Calendar/Gmail integration;
- reviewer and AI retention/capacity policies.

Optional integrations are feature-gated. Google integration variables must be
set as a complete group, while AI chat and analysis require `AI_ENABLED=true`.
Never commit `packages/api/.env` or provider secrets.

## API development

Keep `packages/api/openapi.yaml` synchronized whenever an endpoint or payload
changes, then regenerate the web types:

```bash
npm run gen:api-types --workspace=@raise/web
```

Startup-owned resources must always be scoped by `startupId` and protected by
active membership plus the appropriate permission. See the
[architecture guide](docs/architecture.md#request-and-authorization-path) for
the expected route-to-service pattern.

## Verification before merging

```bash
npm run ci
```

For database changes, commit the Prisma migration with the schema change. For
API changes, update OpenAPI and regenerate frontend types in the same change.
