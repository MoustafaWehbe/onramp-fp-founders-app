# Configuration reference

Every environment variable the API reads, what it does, its default, and when
it is required.

- **File:** `packages/api/.env` (create it from
  [`packages/api/.env.example`](../packages/api/.env.example), which stays the
  canonical commented list).
- **Never commit** `packages/api/.env` or any provider secret.
- **The web app takes no runtime environment variables.** It reaches the API at
  the same origin under `/api`. Provider credentials must never appear in
  frontend environment variables — anything bundled into the client is public.

## Validation at boot

`server.ts` calls `validateEnv()` before anything else. It collects **all**
problems, logs them together, and exits with code 1. Failing at boot is
deliberate: the alternative is discovering a misconfiguration inside a user
request, halfway through an OAuth exchange or an AI stream.

| Rule | Behaviour |
|---|---|
| Always required | `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HMAC_SECRET` |
| Required when `NODE_ENV=production` | `RESEND_API_KEY`, `RESEND_FROM`, `GOOGLE_CLIENT_ID` |
| `APP_URL` | Must be an absolute `http(s)` URL. Falls back to `CORS_ORIGIN`; if both are unset, boot fails. |
| Google integration group | All three of `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, or none. A partial group is an error. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Exactly 64 hex characters (32 bytes) when set. |
| AI group | `getAiConfig()` is evaluated at boot, so an out-of-range AI value fails immediately. |
| Reviewer group | `getReviewerOperationsConfig()` is evaluated at boot for the same reason. |

## Application

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables JSON logging, secure cookies, and the production-required list above. `test` switches rate limiters to in-memory stores and the realtime bus to in-process. |
| `PORT` | `3000` | API HTTP port. |
| `CORS_ORIGIN` | `http://localhost:5173` | Credentialed CORS origin. |
| `APP_URL` | falls back to `CORS_ORIGIN` | Public base URL of the web app. Used to build every link in outgoing email. Trailing slashes are stripped. |
| `TRUST_PROXY` | `0` | Express `trust proxy`. See below. |
| `LOG_LEVEL` | `info` | Pino level: `fatal`…`trace`, or `silent`. |

### `TRUST_PROXY` — get this right

Every rate limiter keys on `req.ip`, and `req.ip` is decided by this value.

| Value | Meaning | When |
|---|---|---|
| `0` | Trust nothing | Local development, or a directly exposed process |
| `1` | Trust one hop | Behind a single nginx / ALB / Cloudflare layer |
| `n` | Trust `n` hops | Match your real topology |
| `10.0.0.0/8,192.168.0.0/16` | Trusted addresses/subnets | Express parses the list itself |

`true` is deliberately **not** special-cased — spell out the hop count or the
addresses. Too low and every user behind the proxy shares one bucket, so a
single attacker locks everyone out. Too high and a client forges
`X-Forwarded-For` to present a fresh IP per request and is never limited.

## Persistence

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | **Required.** PostgreSQL connection string. Compose publishes the database on host port **5433**. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `postgres` / `postgres` / `raise` | Read by `docker-compose.yml` when creating the container, not by the API. |
| `POSTGRES_HOST` / `POSTGRES_PORT` | `localhost` / `5433` | Convenience values; `DATABASE_URL` is what the API uses. |
| `REDIS_URL` | — | **Required.** Queues, rate limits, cron locks, realtime pub/sub, local upload tokens. |
| `REALTIME_BUS` | unset (Redis) | Set to `memory` to force the single-process in-process bus without Redis pub/sub. Automatic under `NODE_ENV=test`. |

> A PostgreSQL volume created earlier keeps its original database name and
> credentials even if the Compose defaults change later. If `DATABASE_URL` and
> the volume disagree, migrating or reseeding will not reconcile them — fix the
> URL or recreate the volume deliberately.

## Secrets and tokens

| Variable | Default | Notes |
|---|---|---|
| `JWT_ACCESS_SECRET` | — | **Required.** Signs 15-minute access tokens. |
| `JWT_REFRESH_SECRET` | — | **Required.** Signs 30-day refresh tokens. Must differ from the access secret. |
| `OTP_HMAC_SECRET` | — | **Required.** HMACs registration and reviewer OTP codes. |
| `PAGE_TOKEN_SECRET` | falls back to `OTP_HMAC_SECRET` | Signs short-lived reviewer page-image tokens. Set it separately in production. |

Use long random values. Rotating `JWT_REFRESH_SECRET` invalidates every session;
rotating `JWT_ACCESS_SECRET` invalidates access tokens until the next refresh.

## Email (Resend)

| Variable | Default | Notes |
|---|---|---|
| `RESEND_API_KEY` | — | Required in production. Without it, no email is delivered. |
| `RESEND_FROM` | — | Required in production. `Display Name <address@domain>`; the domain must be verified in Resend. |

Email is always sent through the `email` queue, so a provider outage retries
rather than failing the originating request.

## Document storage

| Variable | Default | Notes |
|---|---|---|
| `SUPABASE_URL` | unset | Set with the service-role key to use Supabase Storage. |
| `SUPABASE_SERVICE_ROLE_KEY` | unset | Server-side only. Never expose it to a browser. |
| `SUPABASE_STORAGE_BUCKET` | `documents` | **Private** bucket for document bytes and page images. |
| `SUPABASE_AVATARS_BUCKET` | `avatars` | **Public-read** bucket, on purpose — avatars are served by direct URL, never signed links. |
| `SOFFICE_BIN` | `soffice` from `PATH` | LibreOffice headless binary used to convert DOCX/PPTX to PDF before rasterizing. Only installed in the worker image (`Dockerfile.worker`). |

With Supabase unset, uploads fall back to `packages/api/.uploads` with
Redis-gated upload and download tokens. That is a development convenience, not
a production storage backend.

## Document parsing (LlamaParse)

| Variable | Default | Notes |
|---|---|---|
| `LLAMA_CLOUD_API_KEY` | unset | Required to parse PDF/DOCX/XLSX/PPTX. Without it those uploads fail the version with `PARSE_UNAVAILABLE`; `text/plain` still works. |
| `LLAMA_CLOUD_BASE_URL` | `https://api.cloud.llamaindex.ai` | LlamaCloud keys are region-locked. Use `https://api.cloud.eu.llamaindex.ai` for an EU-org key. A region mismatch returns a 401 that reads like a bad key but is not one. |

## AI

Everything below is read through `getAiConfig()` and validated at boot.

| Variable | Default | Notes |
|---|---|---|
| `AI_ENABLED` | `false` | Master switch for AI chat and analysis endpoints. When `true`, `OPENAI_API_KEY` becomes required. |
| `OPENAI_API_KEY` | unset | Also powers document embeddings independently of `AI_ENABLED`. |
| `AI_CHAT_MODEL` | `gpt-4.1-mini` | Conversational copilot. |
| `AI_ANALYSIS_MODEL` | `gpt-4.1` | Pitch-deck analysis. |
| `AI_EMBEDDING_MODEL` | `text-embedding-3-small` | Chunk and query embeddings. |
| `AI_EMBEDDING_DIMENSIONS` | `1536` | **Must stay 1536** while `document_chunks.embedding` is `vector(1536)`. Any other value fails boot. |
| `AI_REQUEST_TIMEOUT_MS` | `30000` | Per provider request. |
| `AI_MAX_OUTPUT_TOKENS` | `2000` | Chat responses. |
| `AI_ANALYSIS_MAX_OUTPUT_TOKENS` | `8000` | Analyses need far more room; 2000 truncated mid-JSON on real decks. |
| `AI_MAX_TOOL_ROUNDS` | `4` | Tool-call rounds per message before the model must answer. |
| `AI_RETRIEVAL_RESULT_COUNT` | `8` | Chunks retrieved per query. |
| `AI_RETRIEVAL_TOKEN_BUDGET` | `4500` | Token ceiling for retrieved context. |
| `AI_MIN_RETRIEVAL_SCORE` | `0.2` | Similarity floor, 0–1. Below it, a chunk is not grounding. |
| `AI_MAX_RETRIES` | `1` | Provider retries. |
| `AI_MESSAGES_PER_MINUTE` | `20` | Per authenticated user, separate from the global limiter. |
| `AI_CONCURRENT_STREAMS_PER_USER` | `2` | Enforced across replicas via the Redis run registry. |
| `AI_ANALYSES_PER_STARTUP_PER_DAY` | `20` | Daily analysis capacity per workspace. |
| `AI_QUEUED_ANALYSES_PER_STARTUP` | `4` | Simultaneously queued analyses per workspace. |
| `AI_CHAT_RETENTION_DAYS` | `0` | `0` means automatic deletion is **off**. A positive value deletes archived sessions past the window, cascading messages, citations, tool calls, and artifacts. |

Retention defaulting to off is deliberate: deleting user prompts and generated
content must be an explicit deployment policy, never an accidental default.

## Google

Sign-in and the Calendar/Gmail integration are separate features.

| Variable | Default | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | — | Required in production. Enables **Sign in with Google** on its own — no secret needed for the ID-token flow. |
| `GOOGLE_CLIENT_SECRET` | unset | Part of the integration group. |
| `GOOGLE_REDIRECT_URI` | derived from `APP_URL` in development | Part of the integration group. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | unset | Part of the integration group. 64 hex characters for AES-256-GCM: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

Set all three integration variables or none. Requested OAuth scopes are
`openid`, `email`, `calendar.events`, and `gmail.send` — sensitive tier, but
deliberately not restricted tier, which keeps the integration usable without an
annual third-party security assessment.

## Reviewer operations and retention

| Variable | Default | Notes |
|---|---|---|
| `METRICS_ENABLED` | `false` | Enables `GET /metrics`. Must be exactly `true` or `false`. |
| `METRICS_TOKEN` | unset | Required when metrics are enabled; **32+ characters**. Scrapers send `Authorization: Bearer <token>`. |
| `REVIEWER_CHALLENGE_RETENTION_HOURS` | `24` | Delete expired unverified access challenges after this. |
| `REVIEWER_NETWORK_RETENTION_DAYS` | `30` | Redact session IP, user agent, visit hashes, and referrer after this. |
| `REVIEWER_ENGAGEMENT_RETENTION_DAYS` | `365` | Delete detailed page-view rows after this. |
| `REVIEWER_EVENT_RETENTION_DAYS` | `365` | Delete copy/print/screenshot security events after this. |

All four windows must be positive integers. Invitations, reviewer comments, and
aggregate visit results are never deleted by retention. See
[reviewer-portal.md](reviewer-portal.md) and [operations.md](operations.md).

## Quick profiles

**Minimum local run** (no third-party accounts):

```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/raise
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=<long random>
JWT_REFRESH_SECRET=<different long random>
OTP_HMAC_SECRET=<long random>
APP_URL=http://localhost:5173
```

**Local with AI:** add `OPENAI_API_KEY`, `AI_ENABLED=true`, and
`LLAMA_CLOUD_API_KEY` if you want to upload anything other than `.txt`.

**Production:** everything above with real secrets, plus `RESEND_API_KEY`,
`RESEND_FROM`, `GOOGLE_CLIENT_ID`, the Supabase group, a `TRUST_PROXY` matching
your topology, `PAGE_TOKEN_SECRET` set separately, and a deliberate
`AI_CHAT_RETENTION_DAYS` decision.
