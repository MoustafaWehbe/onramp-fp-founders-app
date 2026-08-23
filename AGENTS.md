# AGENTS.md

Guidance for AI coding agents working in this repo. The root `README.md` covers
onboarding and `docs/architecture.md` is the architecture source of truth.

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
| Frontend | React 19, Vite, React Router, TanStack Query, Zustand, Tailwind CSS 4, Radix + shadcn/ui-style components |
| Backend | Express, **Prisma** + PostgreSQL, Zod validation |
| Auth | JWT access/refresh cookies, Google OAuth, email OTP (Resend) |
| Background jobs | BullMQ, Redis, node-cron |
| Monorepo | npm workspaces + Turborepo |
| Language | TypeScript everywhere |

The API uses **Prisma** (`packages/api/prisma/schema.prisma`, migrations in
`prisma/migrations/`).

## Setup

```bash
cp packages/api/.env.example packages/api/.env # first: Prisma postinstall loads it
npm install                                  # installs workspaces and generates Prisma
docker compose up -d                         # postgres host :5433, redis :6379, worker
npm run db:migrate --workspace=@raise/api
npm run db:seed --workspace=@raise/api       # destructive; disposable local DB only
```

Seed creates deterministic demo workspaces and accounts. For example:

- `muhamad.houda@gmail.com` / `Founder1234!`
- Primary startup: "Northbeam"

The seed begins by deleting all application rows. Never run it against a
valuable database.

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

- Server state: TanStack Query. Client/UI preferences: Zustand
  (`lib/app-store.ts` remembers the preferred startup, active rounds, and
  chart ranges in localStorage). Auth remains in `AuthProvider`; chat drafts
  use sessionStorage.
- Product dashboard pages call the real API. `lib/mock-data.ts` remains in
  production imports for Pipeline stage display configuration; do not add new
  fixture dependencies there. Split stable configuration from fixtures when
  working in that area.
- `ProtectedRoute` only checks that you're logged in; it does not check
  startup membership. Membership/permission failures surface per-request
  (as a 403 toast on the pages that are wired up), not as a route guard.
- UI primitives in `components/ui/` follow shadcn/ui conventions
  (`class-variance-authority`, `cn()` = `twMerge(clsx(...))`). Dropdown
  and dialog open/close animations depend on the `tailwindcss-animate`
  Tailwind plugin being registered in `src/styles/globals.css` if you ever see
  Radix `data-[state=open]`/`animate-in` classes doing nothing, check the
  `@plugin 'tailwindcss-animate'` declaration first.
  - Box-shadow does not interpolate cleanly across a CSS `transition`
    when the shadow value differs between states (multi-layer shadows
    especially) it can visibly snap/flash instead of animating
    smoothly. Prefer a static `shadow-*` plus `transition-colors` on
    `border-color`/`background-color` for state-based trigger styling
    (see the sidebar `UserMenu`/`StartupSwitcher` triggers) rather than
    swapping the shadow itself.
- Tailwind 4 utilities such as `line-clamp-*` work without a separate plugin.

## Testing

- API: Jest, `packages/api/tests/unit/*.test.ts`, mocks `prisma` per test
  file. Good coverage on services/controllers/schemas for wired resources.
- Web: Vitest + Testing Library under `src/test/`, including page, hook, and
  client-state coverage. There is no full browser E2E workspace yet, so
  cross-process regressions still need manual or future E2E verification.

## Known gotchas hit in this repo

- **The seed is destructive.** `prisma/seed.ts` deletes every application row
  before recreating demo data. Use it only with a disposable local database.
- On Windows, `npx prisma generate` can fail with `EPERM` renaming
  `query_engine-windows.dll.node` if another process (a running dev
  server, a stray Jest worker) still has the file open. Stop other
  processes and retry rather than debugging it as a schema problem.
- ESLint is not installed in some environments here (`npx eslint` fails
  with "not found") even though `npm run lint` is defined fall back to
  `tsc --noEmit` for a sanity check if `npm run lint` errors out on a
  missing binary rather than real lint findings.
