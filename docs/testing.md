# Testing

What is tested, with what, and what a change is expected to add.

## Layers

| Layer | Tooling | Location | Runs |
|---|---|---|---|
| API unit / service / HTTP | Jest + ts-jest + Supertest | `packages/api/tests/unit/` | `npm run test --workspace=@raise/api` |
| Web component / page / hook | Vitest + Testing Library + jsdom | `packages/web/src/test/` | `npm run test --workspace=@raise/web` |
| Contract | OpenAPI YAML → generated types; type-checked at build | `packages/api/openapi.yaml` | `npm run build` |
| Compile | TypeScript + Vite | both packages | `npm run build` |
| AI evaluation | Jest, deterministic, no model calls | `tests/unit/ai-evaluation.service.test.ts`, `ai-rubric.test.ts` | `npm run eval:ai --workspace=@raise/api` |

```bash
npm run test    # both suites with coverage
npm run ci      # lint → test → build, the same gate CI runs
```

There is **no end-to-end browser suite yet.** Flows crossing web → API →
PostgreSQL → Redis → SSE are covered only by unit tests on each side, so
cross-process regressions still need manual verification. Those flows — sign-in,
upload → process → view, reviewer access, chat delivery, AI streaming — should
be the first targets when a browser suite is introduced.

## API tests

~80 suites under `packages/api/tests/unit/`. Prisma is **mocked per test file**;
these are not integration tests against a live database.

`tests/setup.ts` runs before every file: it sets `NODE_ENV=test`, supplies
deterministic secrets and URLs, and silences `console.info`/`console.log`.
`NODE_ENV=test` also switches rate limiters to in-memory stores (so each
limiter's counter is isolated) and the realtime bus to its in-process
implementation (so no Redis is needed).

Jest runs with `--experimental-vm-modules` because `pdfjs-dist` is ESM-only and
`pdf-rasterize.ts` reaches it through a dynamic import; without the flag the
call fails with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`. `forceExit` is
set because `express-rate-limit`'s in-memory store leaves timers behind.

Coverage spans services, controllers, middleware, schemas, workers, config,
utilities, and HTTP-level suites via Supertest (`reviewer-portal.http.test.ts`,
`notification.stream.test.ts`, `health.test.ts`, `ai-stream.controller.test.ts`).

## Web tests

Vitest with jsdom, `globals: true`, and `src/test/setup.ts`. `maxWorkers: 4` and
a 10-second `testTimeout` are deliberate: coverage instrumentation plus parallel
jsdom suites push interaction tests past the 5-second default on Windows and CI
runners.

Suites are grouped by kind — `components/`, `hooks/`, `lib/`, `pages/`,
`providers/` — and cover pages, hooks, client state, and pure helpers.

## What a change should test

Rendering a happy path is the floor, not the bar. Prioritize the cases that
have actually broken things here.

### Backend

| Category | Example |
|---|---|
| **Tenant isolation** | A request for another startup's resource returns 404/403, not data |
| **Permissions** | Each role gets the expected 200 or 403 on every new route |
| **Validation** | Bad payloads return 400 with the right field errors; a `javascript:` URL is rejected |
| **Idempotency** | Re-running a job, or resending a nonce, produces one row |
| **State transitions** | Stage and commitment moves append the right event rows |
| **Error mapping** | Service errors surface as the intended status and code |
| **Cross-replica behavior** | Redis-backed suites (`*.redis.test.ts`) for the buses and run registry |

### Frontend

| Category | Example |
|---|---|
| **States** | Loading, empty, error, retry, permission-denied, small screen |
| **Optimistic flows** | Rollback on failure, retry preserving the nonce |
| **Cache correctness** | Query keys include the startup; no cross-workspace reuse |
| **Permission gating** | Controls hidden or disabled for a role that lacks the grant |
| **User-visible behavior** | Assert what the user sees, not internal implementation |

## Conventions

- Name files after the unit: `<resource>.service.test.ts`,
  `<resource>.schemas.test.ts`, `<page>.test.tsx`.
- Mock at the boundary — Prisma, the AI provider, storage, Resend — not the code
  under test.
- Keep tests deterministic: no real network, no wall-clock dependence, no
  reliance on test ordering.
- Redis-dependent behavior belongs in a `*.redis.test.ts` suite so the intent is
  visible.
- Reuse `tests/fixtures/` rather than re-declaring the same object shape.

## CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`,
with in-progress runs cancelled per ref.

| Step | Detail |
|---|---|
| Node | Pinned to **22.13** — `pdfjs-dist` 6 needs APIs added in that version, and on Node 20 rasterized text silently renders blank |
| Install | `npm ci` with a dummy `DATABASE_URL`, enough for the Prisma `postinstall` |
| Lint | `npm run lint` |
| Test | `npx turbo run test --concurrency=1` — **one package at a time**, because pdfjs + canvas under Jest's experimental VM is memory-sensitive and parallel api+web workers were tearing down the rasterize suite mid-import on the runner |
| Build | `npm run build` |

Mirror it locally with `npm run ci`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` | Jest run without `--experimental-vm-modules`; use the `test` script |
| Rasterize suite dies mid-import | Memory pressure from parallel suites; run with `--concurrency=1` |
| Interaction test times out on Windows | Known slowness under coverage; the timeout is already raised to 10s |
| `prisma generate` fails with `EPERM` | A running Node/Jest process holds the query-engine DLL — stop it and retry |
| Rate-limit test interference | A limiter sharing a store; tests use in-memory stores per limiter under `NODE_ENV=test` |
