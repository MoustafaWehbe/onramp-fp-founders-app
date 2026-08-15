# AGENTS.md

Guidance for AI coding agents working in this repo. `README.md` is stale in
places (it describes Sequelize, `packages/workers`, `packages/shared` none
of which exist anymore); this file reflects the codebase as it actually is.

## What this is

A two-package npm-workspaces monorepo (Turborepo) for an AI fundraising
platform for startups: founders manage investor pipelines, fundraising
rounds, documents, and team access.

```
packages/
  api/   Express REST API port 3000
  web/   React + Vite frontend port 5173
```

There is no `packages/workers` or `packages/shared`. Background jobs
(`cron.ts`, `queue.ts`, BullMQ workers) live inside `packages/api/src/jobs`.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, TanStack Query, Zustand, Tailwind CSS, Radix + shadcn/ui-style components |
| Backend | Express, **Prisma** + PostgreSQL, Zod validation |
| Auth | JWT access/refresh cookies, Google OAuth, email OTP (Resend) |
| Background jobs | BullMQ, Redis, node-cron |
| Monorepo | npm workspaces + Turborepo |
| Language | TypeScript everywhere |

The root README says "Sequelize" ignore that; the API uses **Prisma**
(`packages/api/prisma/schema.prisma`, migrations in `prisma/migrations/`).

## Setup

```bash
npm install                      # installs all workspaces, runs `prisma generate` via postinstall
docker-compose up -d              # postgres (pgvector/pgvector:pg16) on 5432, redis on 6379
cp .env.example packages/api/.env # then fill in secrets
cd packages/api && npx prisma migrate deploy && npm run db:seed
```

Seed creates one user/startup you can log in as immediately:

- `founder@example.com` / `Founder1234!`
- Startup: "Acme Corp", id `00000000-0000-0000-0000-000000000002`
  (exported as `SEED_STARTUP_ID` in `packages/web/src/lib/app-store.ts`)

## Commands

Run from repo root (Turborepo fans these out to both packages), or `cd`
into a package and run directly:

| Command | What |
|---|---|
| `npm run dev` | starts api (tsx watch) + web (vite) in parallel |
| `npm run build` | `tsc` build both packages |
| `npm run test` | api: Jest (`packages/api/tests/unit`); web: Vitest (`packages/web/src/test`) |
| `npm run lint` | ESLint both packages |
| `cd packages/api && npm run db:studio` | Prisma Studio GUI on the local DB |
| `cd packages/api && npm run db:migrate:dev` | create + apply a new migration |
| `cd packages/web && npm run gen:api-types` | regenerate `src/lib/api-types.ts` from `packages/api/openapi.yaml` |

`packages/api/openapi.yaml` is the API contract of record when you add or
change a route, update it in the same change (existing routes keep it in
sync; don't let it drift).

## Backend architecture (`packages/api/src`)

Layering per resource: `routes/*.routes.ts` → `middleware` (auth, RBAC,
Zod `validate()`) → `controllers/*.controller.ts` (thin, wrapped in
`asyncHandler`) → `services/*.service.ts` (Prisma calls, business logic,
throws via `createError(message, statusCode, code)`) → `validators/*.schemas.ts`
(Zod schemas + inferred types).

- **Multi-tenancy**: nearly every resource is scoped to a startup. Routes
  are mounted under `/api/v1/startups/:startupId/...` with `mergeParams:
  true`. Services fetch/update/delete through Prisma composite keys like
  `{ startupId_id: { startupId, id } }` so a request can never touch another
  tenant's row follow this pattern for any new startup-scoped resource.
- **RBAC** (`middleware/rbac.ts`): `requireMember` checks the caller has a
  `StartupMember` row for `req.params.startupId` with
  `status === "active"` no other status value is ever treated as
  authorized (see gotcha below). `requirePermission(resource, action)`
  then checks the member's role has that permission
  (`config/permissions.ts` defines the `PERMISSIONS` list and the
  `owner`/`collaborator`/`viewer` `ROLE_TEMPLATES`).
- **Validation** (`utils/validate.ts` + `validators/*.schemas.ts`): Zod
  schemas validate `body`/`params`/`query` and the parsed, coerced result
  is written back onto `req` before the handler runs.
  - URL fields: plain `z.string().url()` accepts `javascript:` and other
    non-http schemes. The established pattern (see
    `investor.schemas.ts`'s `linkedinUrl`, `startup.schemas.ts`'s
    `website`) is `.url().refine(v => /^https?:\/\//i.test(v))` reuse
    that, don't add bare `.url()` for anything user-controlled.
- Config lookups (pipeline stages, investor types) live in
  `config/crm.ts` and are shared by validators on both the create and
  update path don't hardcode stage/type string literals elsewhere.

## Frontend architecture (`packages/web/src`)

- Server state: TanStack Query. Client/UI state: Zustand
  (`lib/app-store.ts` currently just `activeStartupId` and local
  notification read-state, persisted to localStorage).
- **Not every dashboard page is wired to the real API yet.** As of this
  writing only `pages/dashboard/Pipeline` and `pages/dashboard/Investors`
  call the backend (`lib/pipeline-api.ts` via `apiClient`). Dashboard,
  Fundraising, Documents, AI Insights, Team, Notifications, Settings all
  still render from static fixtures in `lib/mock-data.ts`. Before
  "fixing" a page that looks broken, check whether it's supposed to be
  live yet a 403 from `requireMember`/`requirePermission` only shows up
  on pages that actually call the API.
- `ProtectedRoute` only checks that you're logged in; it does not check
  startup membership. Membership/permission failures surface per-request
  (as a 403 toast on the pages that are wired up), not as a route guard.
- UI primitives in `components/ui/` follow shadcn/ui conventions
  (`class-variance-authority`, `cn()` = `twMerge(clsx(...))`). Dropdown
  and dialog open/close animations depend on the `tailwindcss-animate`
  Tailwind plugin being registered in `tailwind.config.js` if you ever
  see Radix `data-[state=open]`/`animate-in` classes doing nothing, check
  that plugin registration first.
  - Box-shadow does not interpolate cleanly across a CSS `transition`
    when the shadow value differs between states (multi-layer shadows
    especially) it can visibly snap/flash instead of animating
    smoothly. Prefer a static `shadow-*` plus `transition-colors` on
    `border-color`/`background-color` for state-based trigger styling
    (see the sidebar `UserMenu`/`StartupSwitcher` triggers) rather than
    swapping the shadow itself.
- Tailwind v3.4 here `line-clamp-*` works out of the box (merged into
  Tailwind core since 3.3), no separate plugin needed.

## Testing

- API: Jest, `packages/api/tests/unit/*.test.ts`, mocks `prisma` per test
  file. Good coverage on services/controllers/schemas for wired resources.
- Web: Vitest, but coverage is thin only a few `components`/`lib` tests
  exist (`src/test/`). None of the dashboard pages have tests yet, so
  don't assume regressions there would be caught by `npm run test`.

## Known gotchas hit in this repo

- **Seed data can drift out of sync with app logic.** `prisma/seed.ts`
  upserts `StartupMember` with `update: {}` (a no-op on existing rows),
  so if a row's `status` was ever set to anything other than `"active"`
  (the only value `requireMember` accepts), re-running `db:seed` will
  *not* self-heal it. If you hit unexpected 403s on the seeded account,
  check `startup_members.status` directly before assuming an app bug.
- On Windows, `npx prisma generate` can fail with `EPERM` renaming
  `query_engine-windows.dll.node` if another process (a running dev
  server, a stray Jest worker) still has the file open. Stop other
  processes and retry rather than debugging it as a schema problem.
- ESLint is not installed in some environments here (`npx eslint` fails
  with "not found") even though `npm run lint` is defined fall back to
  `tsc --noEmit` for a sanity check if `npm run lint` errors out on a
  missing binary rather than real lint findings.
