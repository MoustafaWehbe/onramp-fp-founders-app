# API reference

Every implemented endpoint, grouped by domain, with the authentication and
permission each one requires.

- **Base path:** `/api/v1`
- **Contract of record:** [`packages/api/openapi.yaml`](../packages/api/openapi.yaml)
  — request and response schemas live there, not here.
- **Interactive:** Swagger UI at `http://localhost:3000/api/docs`; raw YAML at
  `/api/openapi.yaml`.
- **Generated client types:** `packages/web/src/lib/api-types.ts`, produced by
  `npm run gen:api-types --workspace=@raise/web`.

This page is the navigable index: what exists, who may call it, and where the
code is. Use it to find an endpoint; use the YAML for its payload.

## Conventions

| Aspect | Behaviour |
|---|---|
| Auth | HttpOnly cookies. `accessToken` (15 min, path `/api/v1`), `refreshToken` (30 days, path `/api/v1/auth/refresh`), both `httpOnly`, `sameSite=lax`, `secure` in production |
| Caching | Every `/api/v1` response carries `Cache-Control: no-store` |
| Errors | `{ code?, error, errors?, stack? }` — see [backend.md](backend.md#error-model) |
| Validation failures | `400` with `code: "VALIDATION_ERROR"` and `errors: [{ field, message }]` |
| Pagination | `?page` (min 1) and `?limit` (1–100) query parameters |
| Rate limiting | Global 600 requests / 15 min per IP, plus the per-scope limiters noted below |

### Permission notation

`documents:share` means `requirePermission("documents", "share")`, checked
against the caller's role in the startup named by `:startupId`. Every
startup-scoped route additionally runs `authenticate` and `requireMember`
(active membership). The full matrix is in [security.md](security.md).

## Health and platform

Outside `/api/v1`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | Process liveness. Never touches dependencies. |
| GET | `/ready` | none | PostgreSQL + Redis with a 2s timeout; `503` when either is down |
| GET | `/metrics` | Bearer `METRICS_TOKEN` | Prometheus-compatible reviewer metrics. Disabled unless `METRICS_ENABLED=true` |
| GET | `/api/openapi.yaml` | none | Raw contract |
| GET | `/api/docs` | none | Swagger UI |

## Authentication

`src/routes/auth.routes.ts`. `authRateLimiter` counts all attempts;
`credentialRateLimiter` counts only failures. Both are 10 per 15 minutes.

| Method | Path | Auth | Limiter | Purpose |
|---|---|---|---|---|
| POST | `/auth/register/initiate` | none | auth | Start registration, email an OTP |
| POST | `/auth/register/resend` | none | auth | Resend the registration OTP |
| POST | `/auth/register/verify` | none | credential | Verify OTP, create the account, sign in |
| POST | `/auth/login` | none | credential | Password sign-in |
| POST | `/auth/google` | none | credential | Google ID-token sign-in |
| POST | `/auth/refresh` | refresh cookie | — | Rotate the token pair |
| POST | `/auth/logout` | session | credential | Revoke the session family |
| GET | `/auth/me` | session | — | Current user |
| POST | `/auth/forgot-password` | none | auth | Email a reset link |
| POST | `/auth/reset-password` | none | credential | Complete the reset |

## Users

`src/routes/user.routes.ts`, plus one raw-body route registered in `app.ts`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| PATCH | `/users/me` | session | Update profile |
| PUT | `/users/me/avatar` | session | Raw image bytes (`image/webp` or `image/png`, ≤600 KB). Registered in `app.ts` ahead of `express.json()`, with its own rate limiter |
| DELETE | `/users/me/avatar` | session | Remove avatar |
| GET | `/avatar-files/:userId/:filename` | none | Local-storage avatar fallback. Public and cache-friendly on purpose |

## Startups, roles, and members

`src/routes/startup.routes.ts`.

| Method | Path | Requires | Purpose |
|---|---|---|---|
| GET | `/startups` | session | Workspaces the caller belongs to |
| POST | `/startups` | session | Create a workspace (caller has no membership yet) |
| GET | `/startups/:startupId` | member | Workspace profile |
| PATCH | `/startups/:startupId` | `startup:update` | Edit profile |
| DELETE | `/startups/:startupId` | `startup:delete` | Delete workspace |
| PUT | `/startups/:startupId/activate` | member | Remember the last active workspace server-side, so the choice follows the user across devices |
| GET | `/startups/:startupId/roles` | `team:read` | List roles |
| POST | `/startups/:startupId/roles` | `team:manage` | Create a custom role |
| PATCH | `/startups/:startupId/roles/:roleId` | `team:manage` | Edit a role |
| DELETE | `/startups/:startupId/roles/:roleId` | `team:manage` | Delete a role |
| GET | `/startups/:startupId/members` | `team:read` | List members |
| POST | `/startups/:startupId/invites` | `team:create` | Invite a member |
| POST | `/startups/:startupId/invites/:memberId/resend` | `team:create` | Resend an invitation |
| PATCH | `/startups/:startupId/members/:memberId/role` | `team:update` | Change a member's role |
| DELETE | `/startups/:startupId/members/:memberId` | `team:delete` | Remove a member |

## Invitations

`src/routes/invite.routes.ts`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/invites/mine` | session | Invitations addressed to the caller |
| POST | `/invites/mine/:memberId/accept` | session | Accept |
| POST | `/invites/mine/:memberId/decline` | session | Decline |
| POST | `/invites/accept` | optional session | Accept by token from an email link. Uses `optionalAuthenticate` so a signed-out visitor can be routed to sign-in — and so a stranger holding the link cannot act as the invited person |

## Notifications and realtime

`src/routes/notification.routes.ts`. All routes require a session.

| Method | Path | Purpose |
|---|---|---|
| GET | `/notifications` | Paginated feed |
| GET | `/notifications/stream` | **SSE.** One stream per user carrying notification *and* chat events |
| POST | `/notifications/read-all` | Mark all read |
| PATCH | `/notifications/:notificationId/read` | Mark one read |

## Investors (CRM)

`src/routes/investor.routes.ts`, mounted at `/startups/:startupId/investors`.

| Method | Path | Requires | Purpose |
|---|---|---|---|
| GET | `/` | `pipeline:read` | List with search, type, stage, engagement, round, owner filters |
| POST | `/` | `pipeline:create` | Create a contact |
| GET | `/:investorId` | `pipeline:read` | Detail |
| PATCH | `/:investorId` | `pipeline:update` | Update |
| DELETE | `/:investorId` | `pipeline:delete` | Delete |
| GET | `/:investorId/interaction-logs` | `pipeline:read` | Interaction history |
| POST | `/:investorId/send-email` | `pipeline:create` + `emailSendRateLimiter` | Send via the connected Gmail account |
| POST | `/:investorId/schedule-meeting` | `pipeline:create` + `scheduleMeetingRateLimiter` | Create a Google Calendar event |

The last two require the Google integration to be configured and connected.

## Pipeline (deals)

`src/routes/pipeline.routes.ts`, mounted at `/startups/:startupId/pipeline`.

| Method | Path | Requires | Purpose |
|---|---|---|---|
| GET | `/` | `pipeline:read` | Board / list of deals |
| POST | `/` | `pipeline:create` | Add a deal to a round |
| GET | `/analytics` | `pipeline:read` | Funnel and conversion analytics |
| GET | `/focus` | `pipeline:read` | Deals needing attention |
| GET | `/:pipelineId` | `pipeline:read` | Deal detail |
| PATCH | `/:pipelineId` | `pipeline:update` | Move stage, edit deal fields |
| DELETE | `/:pipelineId` | `pipeline:delete` | Remove |
| GET | `/:pipelineId/interaction-logs` | `pipeline:read` | Deal interaction history |
| GET | `/:pipelineId/stage-events` | `pipeline:read` | Stage-change history |

## Interaction logs

`src/routes/interaction-log.routes.ts`, mounted at
`/startups/:startupId/interaction-logs`.

| Method | Path | Requires |
|---|---|---|
| GET | `/` | `pipeline:read` |
| POST | `/` | `pipeline:create` |
| GET | `/:logId` | `pipeline:read` |
| PATCH | `/:logId` | `pipeline:update` |
| DELETE | `/:logId` | `pipeline:delete` |

## Tasks

`src/routes/task.routes.ts`, mounted at `/startups/:startupId/tasks`. Tasks
share the `pipeline` permission family.

| Method | Path | Requires |
|---|---|---|
| GET | `/` | `pipeline:read` |
| POST | `/` | `pipeline:create` |
| GET | `/:taskId` | `pipeline:read` |
| PATCH | `/:taskId` | `pipeline:update` |
| DELETE | `/:taskId` | `pipeline:delete` |

## Fundraising

`src/routes/fundraising.routes.ts`, mounted directly under
`/startups/:startupId`.

| Method | Path | Requires | Purpose |
|---|---|---|---|
| GET | `/fundraising-rounds` | `financial:read` | List rounds |
| POST | `/fundraising-rounds` | `financial:create` | Create a round |
| GET | `/fundraising-rounds/:roundId` | `financial:read` | Round detail |
| PATCH | `/fundraising-rounds/:roundId` | `financial:update` | Edit |
| DELETE | `/fundraising-rounds/:roundId` | `financial:delete` | Delete |
| GET | `/fundraising-rounds/:roundId/metrics` | `financial:read` | Progress against target |
| GET | `/fundraising-rounds/:roundId/funding-history` | `financial:read` | Time series for the chart |
| GET | `/fundraising-rounds/:roundId/commitments` | `financial:read` | Commitments in the round |
| GET | `/commitments` | `financial:read` | All commitments, filterable by status |
| POST | `/commitments` | `financial:create` | Record a commitment |
| GET | `/commitments/:commitmentId` | `financial:read` | Detail |
| PATCH | `/commitments/:commitmentId` | `financial:update` | Change amount or status |
| DELETE | `/commitments/:commitmentId` | `financial:delete` | Remove |

## Documents

`src/routes/document.routes.ts`, mounted at `/startups/:startupId/documents`.
The upload flow is explained in [documents.md](documents.md).

| Method | Path | Requires | Purpose |
|---|---|---|---|
| GET | `/` | `documents:read` | List, filterable by type and archive state |
| GET | `/:documentId` | `documents:read` | Detail with versions |
| GET | `/:documentId/analytics` | `documents:read` | Reviewer engagement for this document |
| POST | `/upload-sessions` | `documents:create` | Phase 1: create metadata + upload target |
| POST | `/:documentId/versions/upload-sessions` | `documents:update` | Phase 1 for a new version |
| POST | `/:documentId/versions/:versionId/confirm` | `documents:update` | Phase 3: bytes uploaded, enqueue processing |
| POST | `/:documentId/versions/:versionId/retry` | `documents:update` | Re-run processing for a failed version |
| POST | `/:documentId/versions/:versionId/promote` | `documents:update` | Make a version current |
| POST | `/:documentId/file-access` | `documents:read` | Short-lived authorized read of the source file |
| POST | `/:documentId/versions/:versionId/pages/:pageNumber/access` | `documents:read` | Short-lived page-image token |
| PATCH | `/:documentId` | `documents:update` | Rename / retype |
| POST | `/:documentId/archive` | `documents:delete` | Archive |
| POST | `/:documentId/restore` | `documents:delete` | Restore |
| DELETE | `/:documentId` | `documents:delete` | Delete permanently |

Two raw-byte routes for the local storage fallback are registered outside this
router:

| Method | Path | Auth | Notes |
|---|---|---|---|
| PUT | `/documents/local-upload/:token` | Redis upload token | Registered in `app.ts` before `express.json()` (≤21 MB raw) |
| GET | `/documents/local-download/:token` | Redis download token | Registered in `src/routes/index.ts` |

## Reviewer invitations (founder side)

`src/routes/reviewer-invitation.routes.ts`, mounted at
`/startups/:startupId/reviewer-invitations`.

| Method | Path | Requires | Purpose |
|---|---|---|---|
| GET | `/` | `documents:read` | List invitations |
| POST | `/` | `documents:share` | Create a data-room link |
| POST | `/:invitationId/revoke` | `documents:share` | Revoke immediately |
| POST | `/:invitationId/resend` | `documents:share` | Resend the link email |
| GET | `/:invitationId/analytics` | `documents:read` | Engagement summary |
| GET | `/:invitationId/activity` | `documents:read` | Paginated activity feed |
| GET | `/comments` | `documents:read` | Reviewer comment inbox |
| POST | `/comments/:commentId/read` | `documents:read` | Mark a comment read |
| POST | `/comments/:commentId/resolve` | `documents:update` | Resolve a comment |

## Reviewer portal (external)

`src/routes/reviewer-portal.routes.ts`, mounted at `/reviewer-portal`. **No
founder session is involved.** Access is a link token plus an email OTP, then a
`reviewerSessionToken` cookie checked by `requireReviewerSession`. Every route
passes through `reviewerMetricsMiddleware`.

| Method | Path | Auth | Limiter | Purpose |
|---|---|---|---|---|
| POST | `/access` | link token | access (10 / 10 min per IP) | Start access, email an OTP |
| POST | `/verify` | link token + OTP | access | Verify and open a session |
| GET | `/workspace` | reviewer session | — | Allowed documents and link controls |
| POST | `/nda/accept` | reviewer session | — | Accept the click-through NDA |
| GET | `/documents/:versionId/manifest` | reviewer session | content (120 / 5 min) | Page manifest. Deliberately never returns a source-file URL |
| GET | `/pages/:versionId/:pageNumber` | reviewer session + page token | content | Watermarked page image |
| GET | `/documents/:versionId/download` | reviewer session | download (10 / hour) | Watermarked PDF, only when `allowDownload` is set |
| GET | `/comments` | reviewer session | — | The reviewer's own comments |
| POST | `/comments` | reviewer session | comment (30 / 15 min) | Leave a comment |
| POST | `/events` | reviewer session | event (60 / 5 min) | Copy / print / screenshot signals |
| POST | `/telemetry` | reviewer session | telemetry (60 / 5 min) | Per-page active-time flush |
| POST | `/complete` | reviewer session | — | Mark the review complete |
| POST | `/logout` | reviewer session | — | End the session |

## AI

`src/routes/ai.routes.ts`, mounted at `/startups/:startupId/ai`. Endpoints that
generate also require `requireAiEnabled` (`AI_ENABLED=true`). Details in
[ai.md](ai.md).

| Method | Path | Requires | Purpose |
|---|---|---|---|
| GET | `/sessions` | `ai_reports:read` | List chat sessions |
| POST | `/sessions` | `ai_reports:create` + AI enabled | Start a session |
| GET | `/sessions/:sessionId` | `ai_reports:read` | Session detail |
| PATCH | `/sessions/:sessionId` | `ai_reports:create` | Rename / archive |
| DELETE | `/sessions/:sessionId` | `ai_reports:create` | Delete (cascades messages, citations, tool calls, artifacts) |
| GET | `/sessions/:sessionId/messages` | `ai_reports:read` | Message history |
| POST | `/sessions/:sessionId/messages` | `ai_reports:create` + AI enabled + `aiMessageRateLimiter` | Submit a prompt |
| GET | `/sessions/:sessionId/messages/:messageId/stream` | `ai_reports:read` + AI enabled | **SSE** generation stream with replay on reconnect |
| POST | `/sessions/:sessionId/messages/:messageId/cancel` | `ai_reports:create` | Cancel generation (works across replicas) |
| GET | `/analyses` | `ai_reports:read` | List pitch-deck analyses |
| POST | `/analyses` | `ai_reports:create` + `documents:read` + AI enabled | Queue an analysis |
| GET | `/analyses/:analysisId` | `ai_reports:read` + `documents:read` | Analysis result |
| POST | `/analyses/:analysisId/cancel` | `ai_reports:create` + `documents:read` | Cancel a queued analysis |
| POST | `/actions/:actionId/approve` | member; the action's own permission is enforced in the service | Execute a proposed action |
| POST | `/actions/:actionId/reject` | `ai_reports:create` | Reject a proposal |

Approving an action re-checks the permission that the underlying manual
operation would require — the model can only ever *propose*.

## Team chat

`src/routes/chat.routes.ts`, mounted at `/startups/:startupId/chat`.

| Method | Path | Requires | Purpose |
|---|---|---|---|
| GET | `/conversations` | `chat:read` | Channels and DMs |
| POST | `/conversations` | `chat:create` | Create a channel |
| POST | `/dm` | `chat:create` | Open or reuse a DM |
| GET | `/conversations/:conversationId/messages` | `chat:read` | Paginated by `seq` |
| POST | `/conversations/:conversationId/messages` | `chat:create` | Send (idempotent on `clientNonce`) |
| GET | `/conversations/:conversationId/messages/:messageId/replies` | `chat:read` | Thread replies |
| POST | `/conversations/:conversationId/read` | `chat:read` | Advance the read cursor |
| PATCH | `/conversations/:conversationId/notify-level` | `chat:read` | Per-conversation notification level |
| PATCH | `/conversations/:conversationId/archived` | `chat:manage` | Archive / restore a channel |
| POST | `/conversations/:conversationId/typing` | `chat:create` | Typing indicator |
| POST | `/messages/:messageId/reactions` | `chat:create` | Toggle a reaction |
| DELETE | `/messages/:messageId` | `chat:create` | Tombstone a message (own message, or moderator via a service-level check) |
| GET | `/mentionables` | `chat:read` | Members, deals, investors, documents, rounds available to `@`-mention |
| POST | `/resolve` | `chat:read` | Resolve mention references to entities |
| GET | `/mentions` | `chat:read` | Mentions of the caller |

## Audit

`src/routes/audit.routes.ts`, mounted at `/startups/:startupId/audit-logs`. All
require `startup:read`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Filterable, paginated activity trail |
| GET | `/facets` | Available filter values |
| GET | `/export` | CSV export |

## Integrations (Google)

`src/routes/integrations.routes.ts`, mounted at `/integrations`. These are
per-user, not per-startup.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/google/callback` | none (OAuth redirect) | Registered before `authenticate` because Google calls it |
| GET | `/google/status` | session | Connection state and scopes |
| GET | `/google/connect` | session | Begin the OAuth flow |
| POST | `/google/disconnect` | session | Revoke and delete stored tokens |
| PATCH | `/google/calendar-sync` | session | Enable/disable calendar sync |
| POST | `/google/calendar-sync/trigger` | session | Enqueue a sync now |
