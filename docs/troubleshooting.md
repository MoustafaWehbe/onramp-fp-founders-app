# Troubleshooting

Failure modes that have actually cost time on this project, and what to do about
them. Add to this page when you lose an afternoon to something.

## Setup and tooling

### `prisma generate` fails with `EPERM` on Windows

```
EPERM: operation not permitted, rename '…query_engine-windows.dll.node…'
```

Another process — a running dev server, a stray Jest worker, Prisma Studio —
still has the DLL open. Stop those processes and retry. This is a file-lock
problem, not a schema problem; do not start editing `schema.prisma` looking for
a cause.

### `npm install` fails on the API postinstall

The `postinstall` runs `prisma generate`, which loads `prisma.config.ts`, which
needs `DATABASE_URL`. Create `packages/api/.env` **before** installing:

```bash
cp packages/api/.env.example packages/api/.env
```

### The API refuses to start and prints a list of problems

That is `validateEnv()` working as designed — it collects every problem and
exits rather than failing later inside a request. Common causes:

| Message | Fix |
|---|---|
| `Missing DATABASE_URL` / `REDIS_URL` / a JWT or OTP secret | Set it; these are always required |
| `APP_URL must be an absolute URL` | Include the scheme; `CORS_ORIGIN` is the fallback |
| `Partial Google integration config` | Set all three integration variables, or none |
| `GOOGLE_TOKEN_ENCRYPTION_KEY must be a 64-character hex string` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `AI_EMBEDDING_DIMENSIONS must remain 1536` | The column is `vector(1536)`; changing it needs a migration and a re-embed |
| `OPENAI_API_KEY is required when AI_ENABLED is true` | Set the key or turn the flag off |
| `METRICS_TOKEN must be at least 32 characters` | Lengthen it or disable metrics |
| `… must be a positive integer` | A reviewer retention window is zero or negative |

## Database

### Connecting to the wrong database

Compose publishes PostgreSQL on host port **5433**, not 5432. `DATABASE_URL`
must say `5433` for a host process.

### A migration or reseed "didn't take"

A PostgreSQL volume created earlier keeps its original database name and
credentials even if the Compose defaults changed later. If `DATABASE_URL` and
the volume disagree you are migrating one database and reading another. Either
keep the URL that matches the volume, or deliberately recreate the volume.

### The seed wiped data you wanted

`prisma/seed.ts` deletes **every application row** before rebuilding demo data.
There is no confirmation prompt. Only ever point it at a disposable local
database. Same for `db:reset`.

### Vector queries return nothing

Check, in order:

1. Is `OPENAI_API_KEY` set? Without it, chunks have no embeddings.
2. Did the `embeddings` job succeed? A version reaches `ready` without vectors.
3. Is `AI_MIN_RETRIEVAL_SCORE` too high for the corpus?
4. Is the version's `processing_status` actually `ready`? The query filters on
   it.

## Documents

### A version is stuck in `processing`

1. Is a worker running, and pointed at the same Redis as the API?
2. Are **two** workers running (host and Docker)? They compete for jobs.
3. Check the failed jobs for that queue and the version's `processingError`.

### `PARSE_UNAVAILABLE`

`LLAMA_CLOUD_API_KEY` is unset, so only `text/plain` can be parsed.

### LlamaParse returns 401 "Invalid API Key. Please check your region"

The key is valid but region-locked. An EU-org key needs
`LLAMA_CLOUD_BASE_URL=https://api.cloud.eu.llamaindex.ai`. It looks exactly like
a bad key and is not one.

### DOCX or PPTX pages never render

Only the Docker worker image installs LibreOffice. A host worker cannot convert
Office files. Either use the Docker worker or install LibreOffice and point
`SOFFICE_BIN` at it.

### Rendered page text is blank

Node is older than 22.13. `pdfjs-dist` 6 uses APIs added in that version to load
its standard font data, and silently renders blank text on Node 20. CI pins
22.13 for exactly this reason.

### A new version did not become current

By design. `promoteNewestUsableDocumentVersion` requires
`processingStatus = "ready"` **and** `renderStatus ∈ {ready, unsupported}`, so a
healthy current version is never displaced while a newer one is still processing
or has failed. Check both statuses.

## Realtime and AI

### Notifications or chat do not update live

- Is the SSE connection open? Both features share one stream at
  `/api/v1/notifications/stream`.
- With more than one API replica, is `REALTIME_BUS` accidentally set to
  `memory`? In-process fan-out cannot reach another replica.
- Does every replica share one Redis?

### AI runs report `AI_ORPHANED`, or cancel does nothing

Replicas are not sharing one Redis. The run registry is what makes a run started
on replica A visible from replica B. Without shared Redis: healthy generations
look orphaned, cancels never reach the process holding the `AbortController`,
and `AI_CONCURRENT_STREAMS_PER_USER` is enforced per process — silently
multiplying the cap by the replica count.

### `AI_INVALID_ANALYSIS`

The model returned JSON that Zod rejected. The usual cause is drift between the
OpenAI structured-output JSON schema and the Zod schema in `config/ai-rubric.ts`:
every field Zod constrains to an enum or a bounded array must repeat that
constraint on the provider side, or the model has no reason to use the exact
tokens Zod requires. Note that string `minLength`/`maxLength` are **not** part
of OpenAI's strict-schema subset and are Zod-only by necessity.

### Analyses truncate mid-JSON

Raise `AI_ANALYSIS_MAX_OUTPUT_TOKENS`. The default is 8000 rather than chat's
2000 precisely because a real deck needs far more room.

## Auth and rate limiting

### Everyone is suddenly rate limited

Almost always `TRUST_PROXY` set too low, so every request behind the load
balancer shares one bucket. Fix the value before raising any budget. Set too
high, the opposite happens: clients forge `X-Forwarded-For` and are never
limited.

### Users are signed out unexpectedly

- Was `JWT_REFRESH_SECRET` rotated? That invalidates every session.
- Did a password reset run? Completing one revokes all of that user's sessions.
- Did a refresh-token reuse alert fire? Replaying a revoked token revokes the
  whole session family deliberately.

### "Please sign in with Google"

That account was created through Google and has no password hash. This is the
correct message, not a wrong-password bug.

## Frontend

### Radix dropdown or dialog animations do nothing

`data-[state=open]` and `animate-in` classes depend on the `tailwindcss-animate`
plugin being registered via `@plugin 'tailwindcss-animate'` in
`src/styles/globals.css`. Check that declaration first.

### A hover or focus transition snaps instead of animating

You are transitioning `box-shadow`. Multi-layer shadow values do not interpolate
cleanly. Use a static `shadow-*` plus `transition-colors` on `border-color` /
`background-color` — see the sidebar `UserMenu` and `StartupSwitcher` triggers.

### A screen shows another workspace's data after switching

A query key is missing the startup scope. Every key must be built through `qk`
in `lib/query-keys.ts` and include the startup id.

### An optimistic update disappears on navigation

Two screens disagree about the shape stored under a shared key. Everything under
`qk.pipeline(...)` stores the paginated envelope `{ data: [...] }`, never a bare
array.

### The frontend types do not match the API

Regenerate them:

```bash
npm run gen:api-types --workspace=@raise/web
```

If they still disagree, `openapi.yaml` has drifted from the routes. Note that
the YAML currently documents five endpoints that do not exist — `/roles`,
`/roles/{roleId}`, `/roles/{roleId}/permissions`, `/permissions`, and
`/users/me/password`. Do not build against them.

## Tests

### `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`

Jest was run without `--experimental-vm-modules`. Use the package `test` script,
which sets it. `pdfjs-dist` is ESM-only and reached through a dynamic import.

### The rasterize suite dies mid-import in CI

Memory pressure from running both packages' suites in parallel. CI already uses
`turbo run test --concurrency=1` for this reason.

### Interaction tests time out on Windows

Known: coverage instrumentation plus parallel jsdom suites are slow there. The
Vitest timeout is already raised to 10 seconds.
