# AGENTS.md

Condensed conventions for AI coding agents working in this repo.

Full documentation lives in [`docs/`](docs/README.md). This file is the fast
brief; when a task needs depth, follow the links rather than guessing.

| Need | Read |
|---|---|
| System boundaries | [docs/architecture.md](docs/architecture.md) |
| Adding an API resource | [docs/backend.md](docs/backend.md) |
| Adding a screen | [docs/frontend.md](docs/frontend.md) |
| Schema change | [docs/data-model.md](docs/data-model.md) |
| Auth, RBAC, tenancy | [docs/security.md](docs/security.md) |
| Endpoint inventory | [docs/api-reference.md](docs/api-reference.md) |
| Environment variables | [docs/configuration.md](docs/configuration.md) |
| Known gotchas | [docs/troubleshooting.md](docs/troubleshooting.md) |

## What this is

A two-package npm-workspaces monorepo (Turborepo) for **Raise**, an AI
fundraising platform: founders manage investor pipelines, rounds, documents,
external reviewer data rooms, team chat, and an AI copilot.

```text
packages/
  api/   Express REST API, port 3000
  web/   React + Vite frontend, port 5173
```

There is no `packages/workers` and no `packages/shared`. Background jobs
(`cron.ts`, `queue.ts`, BullMQ workers) live in `packages/api/src/jobs`.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, React Router 7, TanStack Query, Zustand, Tailwind CSS 4, Radix + shadcn/ui-style components |
| Backend | Express 5, **Prisma 7** + PostgreSQL 16/pgvector, Zod |
| Auth | HttpOnly JWT access/refresh cookies, Google OAuth, email OTP (Resend) |
| Background jobs | BullMQ, Redis, node-cron |
| Language | TypeScript everywhere |

## Setup

```bash
cp packages/api/.env.example packages/api/.env   # first: Prisma postinstall reads it
npm install
docker compose up -d                             # postgres :5433, redis :6379, worker
npm run db:migrate --workspace=@raise/api
npm run db:seed    --workspace=@raise/api        # DESTRUCTIVE: disposable local DB only
```

Seed accounts share the password `Founder1234!`; `muhamad.houda@gmail.com` owns
the "Northbeam" workspace.

## Commands

| Command | What |
|---|---|
| `npm run dev` | api (tsx watch) + web (vite) in parallel |
| `npm run build` / `npm run test` / `npm run lint` | Both packages via Turborepo |
| `npm run ci` | lint → test → build; the exact CI gate |
| `npm run db:migrate:dev --workspace=@raise/api` | Create + apply a migration |
| `npm run db:studio --workspace=@raise/api` | Prisma Studio |
| `npm run gen:api-types --workspace=@raise/web` | Regenerate `src/lib/api-types.ts` from `openapi.yaml` |

`packages/api/openapi.yaml` is the API contract of record. Update it in the same
change as any route or payload edit, then regenerate the frontend types.

## Backend rules (`packages/api/src`)

Layering per resource: `routes/*.routes.ts` → middleware (`authenticate`,
`requireMember`, `requirePermission`, Zod `validate()`) → `controllers/*` (thin,
`asyncHandler`-wrapped) → `services/*` (Prisma, business logic,
`createError(message, status, code)`) → `validators/*.schemas.ts`.

- **Multi-tenancy.** Startup-scoped routers mount under
  `/api/v1/startups/:startupId/...` with `mergeParams: true`. Services read,
  update, and delete through composite keys — `{ startupId_id: { startupId, id } }`
  — so a request physically cannot touch another tenant's row. Follow this for
  every new startup-scoped resource. Middleware alone is not sufficient.
- **RBAC** (`middleware/rbac.ts`). `requireMember` requires a `StartupMember`
  for `req.params.startupId` with `status === "active"` — **no other status is
  ever authorized**. `requirePermission(resource, action)` then checks the role's
  grants. `config/permissions.ts` holds `PERMISSIONS` and the
  `owner`/`collaborator`/`viewer` templates.
- **Validation** (`utils/validate.ts` + `validators/*`). Schemas parse
  `body`/`params`/`query` and the coerced result replaces the value on `req`.
  For `query`, it is installed via `Object.defineProperty` because Express 5
  made `req.query` a re-parsing getter.
  - **URLs**: bare `z.string().url()` accepts `javascript:`. Use
    `.url().refine(v => /^https?:\/\//i.test(v))` — see `investor.schemas.ts`
    (`linkedinUrl`) and `startup.schemas.ts` (`website`).
- **Vocabularies** (pipeline stages, investor types, round and commitment
  statuses, priorities) live in `config/crm.ts` and are shared by create and
  update validators. Never hardcode the literals.
- **AI is propose-only.** Model-reachable tools that would change state create
  an `AiAgentAction` a human approves; approval re-checks the live permission.
  Never give the model a direct write path.

## Frontend rules (`packages/web/src`)

- Server state: TanStack Query, keys built through `qk` in `lib/query-keys.ts`
  and always including the startup scope. Client preferences: Zustand
  (`lib/app-store.ts`, localStorage). Auth: `AuthProvider`. Chat drafts:
  sessionStorage.
- `ProtectedRoute` only checks that you are signed in — **not** workspace
  membership. `RequireWorkspace` guards startup-dependent routes. Membership and
  permission failures surface per request as 403s.
- Frontend permission checks (`lib/permissions.ts`, `usePermissions`) are for
  UX only; the API is authoritative.
- `lib/mock-data.ts` still exports the production Pipeline stage configuration
  (`STAGES`, `getStage`, `DEFAULT_PROBABILITY_BY_STAGE`, `PipelineStageId`). Do
  not add new fixture dependencies there; split stable config out when working
  in that area.
- UI primitives in `components/ui/` follow shadcn/ui conventions
  (`class-variance-authority`, `cn()` = `twMerge(clsx(...))`).
  - Radix `data-[state=open]` / `animate-in` need the `tailwindcss-animate`
    plugin registered via `@plugin 'tailwindcss-animate'` in
    `src/styles/globals.css`. Check that first if animations do nothing.
  - **Do not transition `box-shadow`** — multi-layer values snap instead of
    animating. Use a static `shadow-*` plus `transition-colors` on
    `border-color`/`background-color`, as the sidebar `UserMenu` and
    `StartupSwitcher` triggers do.
- Tailwind 4 ships `line-clamp-*` and similar without extra plugins.

## Testing

- API: Jest, `packages/api/tests/unit/*.test.ts`, Prisma mocked per file.
- Web: Vitest + Testing Library under `src/test/`.
- No browser E2E workspace yet, so cross-process regressions need manual
  verification.
- Cover tenant isolation, permissions, validation failures, idempotency,
  optimistic rollback, and empty/error states — not just the happy path.
- See [docs/testing.md](docs/testing.md).

## Known gotchas

- **The seed is destructive.** `prisma/seed.ts` deletes every application row
  first. Disposable local databases only.
- **Windows `EPERM` on `prisma generate`** — a running Node/Jest process holds
  `query_engine-windows.dll.node`. Stop it and retry; it is not a schema
  problem.
- **Postgres is on host port 5433**, not 5432.
- **Node 22.13+ required.** `pdfjs-dist` 6 renders blank text on Node 20 with no
  error.
- **Run one worker.** `docker compose up` already starts one; also running
  `npm run worker` makes two consumers compete for the same queues. Only the
  Docker image has LibreOffice for DOCX/PPTX conversion.
- **`openapi.yaml` documents five endpoints that do not exist** — `/roles`,
  `/roles/{roleId}`, `/roles/{roleId}/permissions`, `/permissions`, and
  `/users/me/password`. Do not build against them.
- If `npm run lint` fails on a missing binary rather than real findings, fall
  back to `tsc --noEmit` for a sanity check (ESLint is a root-hoisted
  devDependency and normally resolves fine).

## Before finishing a change

1. `npm run ci` passes.
2. Schema change → the migration is committed with it.
3. API change → `openapi.yaml` updated and frontend types regenerated.
4. Docs updated — see the table in
   [docs/contributing.md](docs/contributing.md#keeping-documentation-true).
