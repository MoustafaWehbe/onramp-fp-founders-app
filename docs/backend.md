# Backend guide

How `packages/api` is organized, the conventions every resource follows, and
the recipe for adding one. Read [architecture.md](architecture.md) first for
the system-level picture and [security.md](security.md) for the authorization
rules this guide assumes.

## Layout

```text
packages/api/
├── server.ts              Process bootstrap: env validation, listen, cron, graceful shutdown
├── app.ts                 Express wiring: security, parsers, rate limits, routes, probes
├── openapi.yaml           REST contract of record
├── prisma.config.ts       Prisma CLI configuration (reads DATABASE_URL)
├── prisma/                schema.prisma, migrations/, seed.ts
├── evals/                 Offline AI evaluation fixtures
├── scripts/               One-off maintenance scripts (page-image backfill, smoke upload)
├── tests/                 Jest suites, fixtures, setup
└── src/
    ├── config/            Static configuration and vocabularies (env, ai, crm, permissions, google, reviewer-*)
    ├── controllers/       Thin HTTP translation
    ├── db/                Prisma client and Redis singleton
    ├── emails/            Email templates
    ├── events/            Realtime bus (Redis pub/sub) for notifications and chat
    ├── jobs/              Queues, cron schedules, and BullMQ workers
    ├── middleware/        auth, rbac, rate-limiter, reviewer-auth, ai-enabled
    ├── observability/     Prometheus-compatible reviewer metrics
    ├── routes/            HTTP contract + middleware composition
    ├── services/          Business rules, transactions, tenant-scoped persistence
    ├── types/             Shared and ambient types
    ├── utils/             errors, validate, auth, crypto, logger, sse-writer, mentions, page-token
    └── validators/        Zod schemas and their inferred types
```

## Process bootstrap

`server.ts` runs in a fixed order and none of it is incidental:

1. Load `dotenv`.
2. `validateEnv()` — exit before anything else can half-start.
3. Import `app.ts` (importing earlier would read unvalidated configuration).
4. `prisma.$connect()`, then `app.listen(PORT)`.
5. `startCronJobs()`.
6. Register `SIGTERM`/`SIGINT` handlers that stop cron tasks, close the HTTP
   server (10s grace, then force), close queues, then Redis and Prisma.

`app.ts` middleware order also matters:

| Order | Middleware | Why here |
|---|---|---|
| 1 | `app.set("trust proxy", …)` | Must precede anything reading `req.ip` |
| 2 | `helmet()`, credentialed `cors()` | Security headers before handlers |
| 3 | `cookieParser()` | Sessions are cookie-based |
| 4 | `PUT /api/v1/documents/local-upload/:token` (raw body) | Raw bytes — must precede `express.json()` |
| 5 | `PUT /api/v1/users/me/avatar` (raw body) | Same reason; carries its own `rateLimiter` + `authenticate`, since registering ahead of the global limiter would otherwise leave it unthrottled |
| 6 | `express.json({ limit: "1mb" })`, `urlencoded` | Normal payloads |
| 7 | `pinoHttp` | Structured request logs (skipped in tests) |
| 8 | `Cache-Control: no-store` on `/api/v1` | Every response is session-scoped; a cached copy could be replayed for the next user |
| 9 | `rateLimiter` on `/api/v1/` | Global ceiling |
| 10 | `router` | Application routes |
| 11 | `/api/docs`, `/api/openapi.yaml`, `/metrics`, `/health`, `/ready` | Outside `/api/v1` on purpose |
| 12 | `errorHandler` | Must be last |

## Layering

```text
routes/<resource>.routes.ts        HTTP contract + middleware composition
controllers/<resource>.controller.ts  Thin: read req, call service, shape response
services/<resource>.service.ts     Business rules, transactions, tenant-scoped Prisma
validators/<resource>.schemas.ts   Zod schemas + inferred input types
```

### Routes

Routes declare the contract and compose middleware. They contain no business
logic. Startup-scoped routers are mounted from `startup.routes.ts` with
`mergeParams: true` so `:startupId` is visible downstream.

```ts
router.patch(
  "/:investorId",
  authenticate,
  validate(investorIdParamSchema, "params"),
  requireMember,
  requirePermission("pipeline", "update"),
  validate(updateInvestorSchema),
  investorController.updateInvestor,
);
```

The order is load-bearing: params are validated before `requireMember` reads
`req.params.startupId`, and permissions are checked before the body is parsed.

### Controllers

Thin by design, wrapped in `asyncHandler` so rejections reach the error
middleware. They translate HTTP to service calls and back — no Prisma, no
business branching.

### Services

Services own everything that matters:

- business rules and state transitions;
- transactions (`prisma.$transaction`) where multiple rows must move together;
- **tenant-scoped** queries (see below);
- audit writes via `recordAuditEvent`;
- notifications via `notificationService`;
- enqueueing background work.

They signal failures with `createError(message, statusCode, code)` and are
exported as singletons (`export const investorService = new InvestorService()`).

### Validators

One Zod module per resource, exporting schemas and their inferred types.

## Tenant scoping

Every startup-scoped read, update, and delete goes through a composite selector
so the tenant boundary lives in the query itself:

```ts
// Correct — the row cannot belong to another startup
await prisma.startupInvestor.findUnique({
  where: { startupId_id: { startupId, id: investorId } },
});

// Wrong — middleware is the only thing standing between this and a leak
await prisma.startupInvestor.findUnique({ where: { id: investorId } });
```

Rules:

- Never infer a startup from an untrusted resource ID and then mutate
  unscoped.
- A cross-tenant miss should be indistinguishable from a missing resource.
- `requireMember` is defense in depth, not a substitute for scoping.

## Validation conventions

`validate(schema, target)` parses `body`, `params`, or `query`, replaces the
value on `req` with the parsed and coerced result, and returns a `400` with
`code: "VALIDATION_ERROR"` and a `[{ field, message }]` array on failure.

For `query`, the parsed value is installed with `Object.defineProperty`. Express
5 turned `req.query` into a getter that re-parses the URL on every access, so a
plain assignment is silently lost on the next read.

### URLs

`z.string().url()` alone accepts `javascript:` and other non-web schemes. For
anything user-controlled, refine it:

```ts
linkedinUrl: z.string().url().refine((v) => /^https?:\/\//i.test(v)).optional()
```

See `investor.schemas.ts` (`linkedinUrl`) and `startup.schemas.ts` (`website`).

### Shared vocabulary

Pipeline stages, investor types, round statuses, commitment statuses, task
statuses, and priorities live in `src/config/crm.ts`. Reuse them in both create
and update validators; never hardcode the string literals elsewhere. Values are
listed in the [glossary](glossary.md).

### Pagination

List endpoints take `page` (min 1, default 1) and `limit` (1–100, default
typically 20) as coerced query values, and return a paginated envelope with the
data array plus total/page metadata. Keep the envelope shape consistent — the
frontend's `query-keys.ts` documents cases where a drifting shape broke
optimistic updates.

## Error model

```ts
throw createError("Investor not found", 404, "NOT_FOUND");
```

`errorHandler` is the only place that writes an error response:

```jsonc
{
  "code": "NOT_FOUND",        // present when the error carried one
  "error": "Investor not found",
  "stack": "…"                // development only
}
```

Errors created by `createError` are `isOperational` and their message is shown
to the caller. Anything else becomes a generic `500 Internal server error` with
the real error logged — never leak internals into a response.

| Status | Typical `code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod rejected the payload |
| 401 | `UNAUTHORIZED`, `SESSION_EXPIRED` | No session, expired token, revoked family |
| 403 | `FORBIDDEN`, `INVITATION_INACTIVE` | Not a member, missing permission, invalid reviewer link |
| 404 | `NOT_FOUND` | Missing, or belongs to another tenant |
| 409 | resource-specific | Idempotency or state conflict |
| 429 | — | Rate limited |
| 503 | — | Readiness failure |

## Auditing and notifications

- `recordAuditEvent({ startupId, userId, action, entityType, entityId, changes, ipAddress })`
  is **best effort**: it never throws into the request path, because a failed
  audit insert must not roll back the business mutation it describes.
- Actions are `AUDIT_ACTIONS` (`create`, `update`, `delete`, `revoke`,
  `archive`, `login`, `logout`, `accept`, `decline`, `share`, `view`,
  `download`), extensible with a string.
- Account-level events (login, logout, password change) are not startup-scoped,
  but `audit_logs.startup_id` is required — so they are written once per startup
  the user is currently an active member of.
- Notifications are created through `notificationService`, which persists the
  row and publishes on the realtime bus. Types are in `NOTIFICATION_TYPES`.

## Realtime from the backend

`src/events/realtime-bus.ts` is one per-user channel carrying both notification
and chat events, so the app holds one live connection per user rather than two.
`notification-bus.ts` re-exports it under the older name.

- Transport to the browser: SSE, via `notificationController.stream` and
  `utils/sse-writer.ts`.
- Transport between processes: Redis pub/sub, so cron, workers, and every API
  replica reach whichever process holds the user's open stream.
- `REALTIME_BUS=memory` and `NODE_ENV=test` select the in-process
  implementation so unit tests need no Redis.

## Adding a resource — checklist

1. **Schema** — add the Prisma model with `startupId`, a `@@unique([startupId, id])`
   composite where it will be selected by, and appropriate indexes. Create the
   migration with `db:migrate:dev`.
2. **Validators** — `src/validators/<resource>.schemas.ts`: params, body, and
   query schemas plus inferred types. Reuse `config/crm.ts` vocabularies.
3. **Service** — `src/services/<resource>.service.ts`: tenant-scoped queries,
   business rules, audit writes, notifications, enqueues.
4. **Controller** — `src/controllers/<resource>.controller.ts`: thin, wrapped in
   `asyncHandler`.
5. **Route** — `src/routes/<resource>.routes.ts` with `mergeParams: true`, then
   mount it in `startup.routes.ts`. Compose
   `authenticate → validate(params) → requireMember → requirePermission → validate(body)`.
6. **Permissions** — if a new resource/action pair is needed, add it to
   `config/permissions.ts` **and** the role templates, and migrate existing
   roles.
7. **Contract** — update `openapi.yaml`, then
   `npm run gen:api-types --workspace=@raise/web`.
8. **Tests** — `tests/unit/<resource>.*.test.ts` covering the happy path,
   validation failures, missing permission (403), and cross-tenant access
   (404/403). See [testing.md](testing.md).
9. **Docs** — update [api-reference.md](api-reference.md), and
   [data-model.md](data-model.md) if the schema changed.

## Things to avoid

- Business logic in a controller or route.
- Prisma calls outside a service.
- An unscoped `findUnique({ where: { id } })` on a startup-owned model.
- Trusting `req.body` before `validate()` has run.
- Treating any `StartupMember.status` other than `"active"` as authorized.
- Bare `z.string().url()` on user-controlled input.
- Logging secrets, tokens, document contents, or raw user identifiers.
- Letting `openapi.yaml` drift from the implemented routes.
