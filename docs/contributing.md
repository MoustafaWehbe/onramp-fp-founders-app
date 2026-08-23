# Contributing

The workflow, the conventions, and what a reviewer will look for.

## Before you start

1. Get it running: [getting-started.md](getting-started.md).
2. Understand the boundaries: [architecture.md](architecture.md).
3. Read the guide for the layer you are touching:
   [backend.md](backend.md), [frontend.md](frontend.md), or
   [data-model.md](data-model.md).

## Workflow

```bash
git checkout -b feat/short-description
# … make the change …
npm run ci        # lint → test → build; the same gate CI runs
git commit
```

Branch from `main` and open a pull request against it. `main` is the default and
release branch.

`npm run ci` must pass locally before you push. It is not a formality —
it is exactly what GitHub Actions runs, so a local failure is a guaranteed CI
failure.

## Definition of done, by change type

### API endpoint

- [ ] Zod schemas for params, body, and query
- [ ] Business logic in a **tenant-scoped** service, not the controller
- [ ] Route composes `authenticate → validate(params) → requireMember →
      requirePermission → validate(body)`
- [ ] `openapi.yaml` updated **in the same change**
- [ ] `npm run gen:api-types --workspace=@raise/web` run and the result committed
- [ ] Tests for the happy path, validation failure, missing permission (403),
      and cross-tenant access
- [ ] [api-reference.md](api-reference.md) updated

### Database change

- [ ] `schema.prisma` edited **and** the migration committed with it
- [ ] `startupId` plus `@@unique([startupId, id])` on startup-owned models
- [ ] Indexes for the new access patterns
- [ ] Backward-compatible where a rolling deploy is possible
- [ ] [data-model.md](data-model.md) updated if an invariant changed

### Frontend change

- [ ] Server state in TanStack Query with a key from `lib/query-keys.ts`
- [ ] Only durable preferences in Zustand
- [ ] Controls gated with `usePermissions()`
- [ ] Loading, empty, error, retry, permission, and small-screen states handled
- [ ] Testing Library coverage for the user-visible behavior

### Background job or schedule

- [ ] The job is idempotent, and a comment says how
- [ ] Concurrency chosen for what the job is bound by
- [ ] A schedule is wrapped in `withCronLock` with a matching interval
- [ ] [background-jobs.md](background-jobs.md) updated

### Configuration change

- [ ] `.env.example` updated with a comment explaining the variable
- [ ] Validated at boot in `config/` if a bad value should stop the process
- [ ] [configuration.md](configuration.md) updated

## Code conventions

**Both packages**

- TypeScript everywhere; no `any` in new code.
- Comments explain **why**, not what. The valuable comment is the one recording
  the constraint that is not visible from the code — a provider quirk, an
  ordering requirement, a bug this shape prevents. This codebase has a strong
  habit of that; keep it.
- Match the surrounding style rather than importing your own.
- `npm run lint` must be clean.

**API**

- Layering is not optional: route → controller → service → Prisma.
- Never call Prisma outside a service.
- Never select a startup-owned row without the tenant in the query.
- Fail with `createError(message, status, code)`.
- Reuse the vocabularies in `config/crm.ts`.
- Refine every user-controlled URL to `http(s)`.

**Web**

- Build query keys through `qk`, never inline.
- Use generated types from `lib/api-types.ts`; never hand-edit that file.
- Follow shadcn/ui conventions in `components/ui`; use `cn()` for class merging.
- Do not add new dependencies on `lib/mock-data.ts`.

## Pull requests

`.github/PULL_REQUEST_TEMPLATE.md` asks for an overview, the change type, the
main changes and their impact, screenshots for visual changes, how to test, and
a checklist. Fill it in properly — "updated code" tells a reviewer nothing.

Keep pull requests focused. A schema change, an endpoint, and a UI redesign in
one branch is three reviews wearing a trench coat.

## What reviewers check

1. **Tenancy** — can any new query reach another workspace's row?
2. **Authorization** — is the right `requirePermission` on the route, and does
   the frontend gate match?
3. **Validation** — is every new input parsed, and are URLs scheme-refined?
4. **Contract** — do `openapi.yaml`, the generated types, and the routes agree?
5. **Migrations** — is the migration committed, and is it safe mid-deploy?
6. **Idempotency** — will a retried job or a duplicated request do the right
   thing?
7. **States** — does the UI handle loading, empty, error, and denied?
8. **Tests** — do they cover the failure paths, not just the happy one?
9. **Docs** — did the change invalidate a page in `docs/`?
10. **Secrets** — is anything sensitive being logged or committed?

## Keeping documentation true

Documentation drift is a bug. Update the matching page in the same pull request:

| Change | Page |
|---|---|
| System boundary or runtime component | [architecture.md](architecture.md) |
| Endpoint, payload, or permission | `openapi.yaml` + [api-reference.md](api-reference.md) |
| Schema model or invariant | [data-model.md](data-model.md) |
| Environment variable | `.env.example` + [configuration.md](configuration.md) |
| Queue, worker, or schedule | [background-jobs.md](background-jobs.md) |
| Retention window or alert threshold | [operations.md](operations.md) |
| User-visible capability | [features.md](features.md) |
| A gotcha you lost an afternoon to | [troubleshooting.md](troubleshooting.md) |

Also update [`AGENTS.md`](../AGENTS.md) when a convention changes — it is the
condensed brief coding agents read.

## Sensitive changes

- Never log secrets, tokens, document contents, or unbounded user identifiers
  (metric labels included).
- Never put a provider credential in a frontend environment variable.
- Preserve audit and history rows where the domain requires an immutable trail.
- Treat `db:seed`, `db:reset`, and raw storage deletion as production-risk
  operations.
- Keep retention changes explicit and documented.
- New AI tools need the correct permission requirement — and if they write, they
  must be propose-only. See [ai.md](ai.md#propose-only-actions).

## Spell check

`cspell.json` holds the project word list. If a legitimate term trips the
checker, add it there rather than reshaping the prose.
