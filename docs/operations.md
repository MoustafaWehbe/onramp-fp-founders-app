# Operations

Deploying, running, observing, and troubleshooting Raise in a real environment.

## Deployment topology

Minimum production deployment:

| Component | Notes |
|---|---|
| Built web assets | `packages/web/dist`, served by any static host or CDN |
| API process | `node dist/server.js` (from `npm run build -w @raise/api`), horizontally scalable |
| Worker process | `node dist/src/jobs/workers/index.js`, scaled by queue depth |
| PostgreSQL 16 + pgvector | One instance shared by every API and worker replica |
| Redis 7 | One instance shared by every API and worker replica |
| Object storage | Supabase: a **private** documents bucket and a **public-read** avatars bucket |

**API replicas must share one PostgreSQL and one Redis.** Rate limits, cron
locks, realtime fan-out, and AI run ownership are all Redis-coordinated; split
them and each of those silently degrades.

Prefer keeping the web app and API on the **same origin** (a reverse proxy
routing `/api` to the API). That is what development does, and it keeps
`sameSite=lax` cookies and SSE working without special cases. If you cannot,
configure `CORS_ORIGIN` and cookie attributes to match your real topology.

### Worker image

`Dockerfile.worker` builds the worker: multi-stage Node 24 build, dev
dependencies pruned, running as the non-root `node` user with `dumb-init` as
PID 1 so `SIGTERM` reaches the BullMQ workers.

It installs **LibreOffice** and `fonts-liberation`, which is what makes
DOCX/PPTX → PDF conversion possible. A worker without LibreOffice fails those
rasterization jobs. The image is also the reason `SOFFICE_BIN` exists.

## Release procedure

1. **Build** — `npm run ci` (lint, test, build) must pass.
2. **Migrate** — run `npm run db:migrate --workspace=@raise/api`
   (`prisma migrate deploy`) as a release step, **before** the new API serves
   traffic. Never `db push`.
3. **Deploy the API**, then the worker. Both are safe to roll: they handle
   `SIGTERM` and drain.
4. **Verify** — `/health` returns 200, `/ready` returns 200 with both checks
   `ok`, and a smoke sign-in works.

Prefer backward-compatible migrations (add nullable column → backfill → enforce)
so a migration is safe against the previous release still running during a
rolling deploy.

## Configuration checklist for production

| Item | Requirement |
|---|---|
| `NODE_ENV` | `production` — enables secure cookies and JSON logging |
| `TRUST_PROXY` | The **real** hop count. See below |
| `APP_URL` | The public web origin; every email link is built from it |
| JWT and OTP secrets | Long, random, distinct |
| `PAGE_TOKEN_SECRET` | Set explicitly, not inherited from `OTP_HMAC_SECRET` |
| `RESEND_API_KEY`, `RESEND_FROM` | Required; sending domain verified |
| `GOOGLE_CLIENT_ID` | Required |
| Supabase group | Required for real document storage |
| `AI_CHAT_RETENTION_DAYS` | A deliberate decision, not the default |
| `METRICS_ENABLED` / `METRICS_TOKEN` | Only if scraped over a private network |

Full reference: [configuration.md](configuration.md).

### `TRUST_PROXY` is a production incident waiting to happen

Every rate limiter keys on `req.ip`.

- **Too low** — everyone behind the load balancer shares one bucket, so a single
  attacker locks out every user.
- **Too high (or `true`)** — a client forges `X-Forwarded-For` to present a
  fresh IP on every request and is never limited at all.

Set it to the number of proxies actually in front of the process, or to an
explicit list of trusted addresses. `true` is deliberately not accepted as a
shortcut.

## Health and readiness

| Endpoint | Checks | Use for |
|---|---|---|
| `GET /health` | Process is alive. **Nothing else** | Liveness probe |
| `GET /ready` | PostgreSQL `SELECT 1` + Redis `PING`, 2s timeout each | Readiness probe / load-balancer membership |

`/ready` returns `503` with `{ status: "not_ready", checks: { database, redis } }`
when either dependency is unavailable, so a replica with a broken dependency
stops receiving traffic while staying alive for diagnosis. That separation is
the point: a `/health` that checked dependencies would kill the very process you
need to inspect.

## Logging

Pino, structured JSON in production and pretty in development, level from
`LOG_LEVEL`. `pino-http` logs every request (skipped under `NODE_ENV=test`).

Never log secrets, tokens, document contents, or unbounded user identifiers.

Log events worth alerting on:

| Event | Meaning |
|---|---|
| `reviewer_email_failed` | A reviewer invitation email did not send |
| `reviewer_retention_failed` | The daily retention job threw |
| `Security alert: token reuse detected` | A revoked refresh token was replayed; the session family was revoked |
| `job failed` | A BullMQ job exhausted its attempts |
| `Invalid environment configuration` | Boot-time validation failed (process exits 1) |

## Metrics

`GET /metrics` serves bounded Prometheus-compatible reviewer metrics. Disabled
by default; requires `METRICS_ENABLED=true` and a 32+ character `METRICS_TOKEN`
sent as `Authorization: Bearer <token>`. Keep it on a private network even with
authentication — it is deliberately mounted outside `/api/v1` so infrastructure
can scrape it without application auth.

**Labels are bounded on purpose** and never include emails, IP addresses,
invitation ids, session ids, document ids, or startup ids. An unbounded label is
both a cardinality explosion and a privacy leak.

| Metric | Type | Labels |
|---|---|---|
| `raise_reviewer_portal_http_requests_total` | counter | `operation`, `status_class` |
| `raise_reviewer_portal_http_request_duration_seconds` | summary | `operation` |
| `raise_reviewer_rate_limit_hits_total` | counter | `scope` |
| `raise_reviewer_retention_runs_total` | counter | `outcome` |
| `raise_reviewer_retention_records_total` | counter | `action` |
| `raise_reviewer_retention_last_success_timestamp_seconds` | gauge | — |

### Recommended alerts

| Alert | Condition |
|---|---|
| Retention stalled | No successful retention run for 48 hours |
| Reviewer access failing | Access/verification 5xx above 1% for 10 minutes |
| Reviewer content failing | Download/page 5xx above 1% for 10 minutes |
| Abuse or misconfiguration | Sustained rise in access or download rate-limit hits |
| Email delivery | Any `event=reviewer_email_failed` |
| Readiness | `/ready` non-200 on any replica |
| Queue backlog | Depth growing without drain on any queue |

Outside the reviewer surface there is no application metrics endpoint yet.
Infrastructure-level HTTP metrics, plus the log events above, are the current
signal. Extending `observability/` is the natural place to add more — keep new
labels bounded.

## Retention jobs

| Job | Schedule | Governs |
|---|---|---|
| Reviewer data retention | 03:45 daily | Reviewer credentials, network data, page views, security events |
| AI chat retention | 03:15 daily, **only if `AI_CHAT_RETENTION_DAYS > 0`** | Archived AI sessions and everything cascading from them |
| Pending registration cleanup | Every 30 min | Expired OTP registrations |
| Stale upload cleanup | Every 30 min | `pending_upload` versions older than an hour |

All run behind the shared Redis cron lock, so exactly one API replica performs
each logical tick. Windows and defaults: [configuration.md](configuration.md)
and [reviewer-portal.md](reviewer-portal.md#privacy-retention).

## Scaling

| Symptom | Action |
|---|---|
| Slow API responses, healthy DB | Add API replicas |
| Queue depth growing | Add worker replicas |
| Document rasterization backlog | Add workers; `document-rasterize` is concurrency 1 per worker by design |
| Slow retrieval | Check pgvector index health and corpus size; see [ai.md](ai.md#retrieval) |
| Rate limits firing for legitimate users | Verify `TRUST_PROXY` before raising any budget |

Cron adds no scaling constraint — the lock keeps it single-execution however
many replicas exist.

## Backup and recovery

- **PostgreSQL is the system of record.** Back it up with point-in-time
  recovery; it holds every business record, the audit trail, and document
  chunks and embeddings.
- **Object storage holds bytes only.** Restoring it without the matching
  database rows leaves orphaned objects; restoring the database without storage
  leaves documents whose bytes are gone.
- **Redis is not durable state.** Losing it drops in-flight jobs, rate-limit
  counters, cron locks, and AI stream replay buffers. Nothing business-critical
  is lost, but in-flight jobs should be considered abandoned.
- Test recovery by restoring into a scratch environment and running
  `npm run db:migrate`.

## Runbooks

### API will not start

Check the boot log. `validateEnv()` prints every problem at once and exits 1.
Common causes: a missing required variable, a partial Google integration group,
a malformed `GOOGLE_TOKEN_ENCRYPTION_KEY`, an AI value out of range, or a
non-positive reviewer retention window.

### `/ready` returns 503

The body names which dependency failed. Verify `DATABASE_URL` and `REDIS_URL`,
network reachability, and that the two-second timeout is not simply masking a
badly overloaded database.

### Everyone is being rate limited

Almost always `TRUST_PROXY`. If it is too low, all traffic behind the load
balancer shares one bucket. Fix the value before touching any budget.

### Documents stuck in `processing`

1. Is the worker running, and connected to the same Redis as the API?
2. Are two workers competing (host **and** Docker)?
3. Check the queue's failed jobs and the version's `processingError`.
4. `PARSE_UNAVAILABLE` means `LLAMA_CLOUD_API_KEY` is unset — or set for the
   wrong region, which returns a 401 that reads like a bad key.
5. DOCX/PPTX rasterization failures usually mean a worker without LibreOffice.

Retry with `POST /:documentId/versions/:versionId/retry`.

### AI streams are being marked orphaned

Confirm every replica shares one Redis. The run registry is what makes a run
started on replica A visible from replica B; without shared Redis, healthy
generations look orphaned, cancels never arrive, and the per-user concurrency
cap is multiplied by the replica count.

### Reviewer links are not being delivered

Check the `email` queue for failures and search logs for
`reviewer_email_failed`. Verify `RESEND_API_KEY` and that `RESEND_FROM` uses a
verified domain. Use `/resend`, which bumps the delivery generation so any stale
queued send is skipped rather than duplicated.

### A refresh-token reuse alert fired

A revoked refresh token was replayed. The session family was revoked
automatically and the user must sign in again. Investigate whether the token
leaked; the grace window means an ordinary network retry does not trigger this.

## Security operations

- Rotate JWT secrets deliberately: rotating the refresh secret signs every user
  out; rotating the access secret invalidates access tokens until the next
  refresh.
- Removing a member takes effect immediately — `requireMember` reads live
  membership on every request.
- Revoking a reviewer invitation takes effect on the reviewer's next request;
  the middleware re-checks invitation state every time.
- Treat `db:seed`, `db:reset`, and raw storage deletion as production-risk
  operations. They are development tools.
