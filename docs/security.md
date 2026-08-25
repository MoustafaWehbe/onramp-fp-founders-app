# Security model

How Raise decides who someone is, what workspace they are in, what they may do,
and what stops abuse. Read this before touching auth, RBAC, or any
startup-scoped query.

## Threat model in one paragraph

Raise holds a startup's most sensitive material: investor relationships,
financials, and fundraising documents. Two failure modes matter most —
**cross-tenant leakage** (workspace A seeing workspace B) and **uncontrolled
external sharing** (a data-room link reaching someone it was never sent to).
Every design decision below serves one of those two, plus keeping AI from
becoming a confused deputy.

## Founder sessions

### Tokens and cookies

| Cookie | Lifetime | Path | Attributes |
|---|---|---|---|
| `accessToken` | 15 minutes | `/api/v1` | `httpOnly`, `sameSite=lax`, `secure` in production |
| `refreshToken` | 30 days | `/api/v1/auth/refresh` | `httpOnly`, `sameSite=lax`, `secure` in production |

Tokens never touch JavaScript. There is no `localStorage` token, so an XSS
payload cannot exfiltrate a session by reading storage. The narrow refresh
cookie path means the long-lived credential is only sent to the one endpoint
that rotates it.

### Every request is checked twice

`authenticate` does not stop at verifying the JWT signature:

1. Verify the access token.
2. Confirm the token's **session family** (`familyId`) still has a live,
   unrevoked `RefreshToken` row.

Without step 2, a signed access token would stay valid for its full 15 minutes
after logout or revocation. With it, logout and forced revocation take effect
immediately. On failure the middleware clears both cookies so the browser stops
replaying a dead session.

`optionalAuthenticate` populates `req.user` when a valid session exists and does
nothing otherwise. It exists for endpoints that must be reachable signed-out but
still need to know who is asking — accepting an invitation is the case in point:
a stranger holding the link must not be able to act as the invited person.

### Refresh rotation and reuse detection

`POST /auth/refresh` rotates the pair: the presented token is revoked and
replaced, linked by `replacedById`, within one transaction.

If a **already-revoked** token is presented outside a short grace window, that
is replay of a stolen token. The response is not just a rejection — the entire
session family is revoked (or, for legacy rows with no `familyId`, every session
for that user), and a security alert is logged. The grace window exists so a
genuine network retry or a tab race does not look like an attack.

Multiple tabs are handled client-side: `api-client.ts` serializes refreshes
through the Web Locks API so two tabs cannot race to rotate the same token.

### Sign-in paths

| Path | Notes |
|---|---|
| Password | bcrypt hashes. An account created through Google has no password hash, and the login route says so rather than reporting a wrong password |
| Email OTP (registration) | HMAC-hashed with `OTP_HMAC_SECRET`, time-limited, attempt-counted in `PendingRegistration`. Expired rows are swept every 30 minutes |
| Google ID token | Verified with `google-auth-library` against `GOOGLE_CLIENT_ID`. No client secret needed for this flow |
| Password reset | Single-use hashed token. Completing a reset **revokes every session for that user** |

Login, logout, and password changes are written to the audit trail — once per
startup the user is an active member of, since `audit_logs.startup_id` is
required.

## Authorization

Three layers, all required.

### 1. Membership — `requireMember`

Loads the caller's `StartupMember` for the **exact** `:startupId` in the URL and
accepts only `status === "active"`. `pending`, `revoked`, or anything else is a
403. Never treat any other status as authorized.

### 2. Permission — `requirePermission(resource, action)`

Checks the member's role for the `resource:action` grant. Related helpers:

- `hasPermission(roleId, resource, action)` — the same check exposed to
  services that need a finer decision than gating a whole route (for example
  "delete your own message, or be a moderator").
- `getRolePermissions(roleId)` — the role's full grant set in one query, for
  callers that need several answers at once.

### 3. Tenant-scoped persistence

Middleware is not enough. Services select through composite keys so the tenant
boundary lives in the query:

```ts
prisma.startupInvestor.findUnique({
  where: { startupId_id: { startupId, id: investorId } },
});
```

Rules:

- Never infer a startup from an untrusted resource ID and then mutate unscoped.
- A cross-tenant miss should be indistinguishable from a missing resource — do
  not leak the existence of another workspace's rows through a 403/404
  difference.
- Composite foreign keys (`[id, startupId]`) push the same invariant into the
  database. See [data-model.md](data-model.md).

## Permission matrix

Defined in `packages/api/src/config/permissions.ts`.

| Resource | Actions |
|---|---|
| `startup` | `read`, `update`, `delete` |
| `team` | `read`, `create`, `update`, `delete`, `manage` |
| `pipeline` | `read`, `create`, `update`, `delete` |
| `documents` | `read`, `create`, `update`, `delete`, `share` |
| `financial` | `read`, `create`, `update`, `delete` |
| `ai_reports` | `read`, `create` |
| `chat` | `read`, `create`, `manage` |

`pipeline` covers investors, deals, tasks, and interaction logs.
`startup:read` also gates the audit trail. `documents:share` is what creates or
revokes a reviewer link.

`requireMember` resolves the role's whole grant set in the same query as the
membership and attaches it as `req.member.permissions`. Every gate below it —
`requirePermission`, `requireAnyPermission`, `memberCan` — reads from that set,
so a route carrying several checks still costs one query. `getRolePermissions`
remains for callers holding only a `roleId` and no request (background jobs,
deferred AI-action approval).

### Permission dependencies

Some grants are inert without another: `pipeline:update` over a role that
cannot `pipeline:read` produces a page that renders empty while every read
behind it 403s. `PERMISSION_DEPENDENCIES` in `config/permissions.ts` declares
those pairs, and `expandPermissionKeys` closes any requested selection over
them on **every** role write. A role therefore cannot be persisted in that
broken shape regardless of which client sent it; the role editor mirrors the
same map so the checkboxes agree with what will be saved.

### Grants that gate a screen, not a secret

`GET /fundraising-rounds` accepts `financial:read` **or** `pipeline:read`. The
pipeline board is round-scoped — it cannot pick a scope, denominate an amount,
or add a deal without knowing which round it is on — but "which rounds exist"
is not the same secret as "how much we are raising and how much is in". A
caller without `financial:read` gets round identity with every money and equity
figure nulled (`redactRoundFinancials`, marked `financialsRedacted: true`).
Round detail, metrics, funding history, and every commitment endpoint still
require the financial grant outright.

Before this split, revoking "Rounds & commitments" from a role took the whole
pipeline board with it — including from the seeded `viewer`, which never had
`financial:read`.

### Seeded role templates

| Permission | owner | collaborator | viewer |
|---|:---:|:---:|:---:|
| `startup:read` | ✅ | ✅ | ✅ |
| `startup:update` / `startup:delete` | ✅ | — | — |
| `team:read` | ✅ | ✅ | ✅ |
| `team:create` | ✅ | ✅ | — |
| `team:update` / `team:delete` / `team:manage` | ✅ | — | — |
| `pipeline:read` | ✅ | ✅ | ✅ |
| `pipeline:create` / `pipeline:update` | ✅ | ✅ | — |
| `pipeline:delete` | ✅ | — | — |
| `documents:read` | ✅ | ✅ | ✅ |
| `documents:create` / `documents:update` | ✅ | ✅ | — |
| `documents:delete` / `documents:share` | ✅ | — | — |
| `financial:read` | ✅ | ✅ | — |
| `financial:create` / `update` / `delete` | ✅ | — | — |
| `ai_reports:read` / `ai_reports:create` | ✅ | ✅ | read only |
| `chat:read` / `chat:create` | ✅ | ✅ | ✅ |
| `chat:manage` | ✅ | — | — |

Roles are per-startup rows, so a workspace can define custom roles beyond these
templates. Adding a new `resource:action` pair means updating
`config/permissions.ts`, the templates, **and** migrating existing roles —
otherwise existing owners silently lack the new grant.

### The frontend mirror is not a control

`packages/web/src/lib/permissions.ts` duplicates the catalog, the labels, and
the dependency map so the UI can render the right controls and read-only
states; `lib/page-access.ts` maps each route to the one grant it cannot render
without, and the sidebar and the `RequirePermission` route guard both read it,
so a hidden nav item is always a guarded route and vice versa.

All of it is presentation only. A UI check that is wrong is a UX bug; a missing
backend check is a security bug. `src/test/lib/permissions.test.ts` imports the
API's catalog directly and fails the build the moment the two drift.

## Reviewer access

External reviewers never enter the founder shell and never receive a founder
session. Full detail in [reviewer-portal.md](reviewer-portal.md); the security
essentials:

| Control | Mechanism |
|---|---|
| Link authenticity | The URL token is stored only as `tokenHash` |
| Identity | Email OTP challenge before any content is reachable |
| Session | Separate `reviewerSessionToken` cookie → `ReviewerSession` row, 8-hour TTL, checked by `requireReviewerSession` |
| Revocation | `revokedAt` / `status` on both invitation and session, checked on every request |
| Expiry | Invitation `expiresAt` and session `expiresAt`, both enforced per request |
| Domain restriction | `allowedEmailDomains` on the invitation |
| Content scope | `ReviewerInvitationDocument` allowlist — nothing outside it is reachable |
| No source files | The manifest endpoint deliberately never returns a signed URL for the original object. Reviewers see rendered page images |
| Page authorization | A short-lived HMAC page token **in addition to** the session cookie. The route checks that the session id inside the token matches the cookie's session, so a leaked token alone proves nothing |
| Download | Off by default; when enabled, a watermarked PDF behind a 10-per-hour limit |
| Deterrents | Watermarking, screenshot guard, print control, and copy/print/screenshot event recording |
| Confidentiality | Optional click-through NDA; the rendered text is snapshotted on the invitation, so accepting an old link accepts exactly the version that was sent |

Failure responses are deliberately uniform: `verifyPageToken` returns null for
anything malformed, mis-signed, or expired, and callers must not report which
check failed.

## HTTP and abuse controls

- **Helmet** for security headers; **credentialed CORS** pinned to
  `CORS_ORIGIN`.
- **`Cache-Control: no-store` on every `/api/v1` response** — every response is
  session-scoped, and a cached copy held by a browser or intermediary could be
  replayed for whoever signs in next.
- **Payload caps**: 1 MB JSON, 21 MB raw document upload, 2 MB raw avatar
  upload (600 KB enforced by the avatar service).
- **Structured request logging** via `pino-http`.

### Rate limiters

Counters live in **Redis**, so they survive restarts and are shared across
replicas — an in-memory store would let an attacker reset their budget by
waiting for a deploy or by spreading attempts across instances. Tests fall back
to in-memory stores for isolation.

IPv6 addresses are normalized to their subnet before keying, because most ISPs
hand out a whole /56 to one customer, and a raw address would let a client hop
to a fresh key on every request.

| Limiter | Budget | Key |
|---|---|---|
| Global `/api/v1` | 600 / 15 min | IP |
| Auth (`authRateLimiter`) | 10 / 15 min | IP, counts all attempts |
| Credential (`credentialRateLimiter`) | 10 / 15 min | IP, counts **failures only** |
| Investor email send | mailbox flood window | user id, IP fallback |
| Meeting scheduling | mailbox flood window | user id, IP fallback |
| AI messages | `AI_MESSAGES_PER_MINUTE` (default 20) / min | user id |
| Reviewer access | 10 / 10 min | IP |
| Reviewer content | 120 / 5 min | reviewer session |
| Reviewer download | 10 / hour | reviewer session |
| Reviewer comment | 30 / 15 min | reviewer session |
| Reviewer events | 60 / 5 min | reviewer session |
| Reviewer telemetry | 60 / 5 min | reviewer session |

Reviewer limiter rejections increment a bounded metric, so a sustained rise is
visible in monitoring. See [operations.md](operations.md).

### `TRUST_PROXY`

Every limiter keys on `req.ip`, which Express derives from this setting. Set it
to the real hop count. Too low and everyone behind the load balancer shares one
bucket, so one attacker locks out every user. Too high (or `true`) and a client
forges `X-Forwarded-For` to present a fresh IP per request and is never limited.
`true` is deliberately not special-cased.

## Input validation

- Every untrusted input is parsed by a Zod schema before a controller runs, and
  `req.body` / `req.params` / `req.query` are **replaced** with the parsed
  result.
- **URLs need a scheme refinement.** `z.string().url()` accepts `javascript:`
  and other non-web schemes, which becomes stored XSS the moment the value is
  rendered as a link. Use `.url().refine(v => /^https?:\/\//i.test(v))` — see
  `investor.schemas.ts` and `startup.schemas.ts`.
- Shared vocabularies come from `config/crm.ts`, so a create and an update path
  cannot disagree about valid values.

## Secrets

| Secret | Handling |
|---|---|
| JWT and OTP secrets | Environment only, never logged |
| Google refresh tokens | Encrypted at rest with AES-256-GCM (`GOOGLE_TOKEN_ENCRYPTION_KEY`); iv + auth tag + ciphertext packed into one base64 column value |
| Reviewer link tokens, session tokens, invite tokens, reset tokens | Stored **hashed**, never in plaintext |
| Page tokens | HMAC-signed, 10-minute TTL, not stored |
| Supabase service-role key | Server-side only |
| `METRICS_TOKEN` | 32+ characters, required when metrics are enabled |

Never put a provider credential in a frontend environment variable — anything
bundled into the client is public. Never log secrets, tokens, document
contents, or unbounded user identifiers (metric labels included).

## AI-specific controls

The AI subsystem treats the model as untrusted input, not as a privileged
actor:

- **Tools are an allowlist derived from the caller's role.** A missing
  underlying permission removes the capability entirely — the tool is not even
  offered to the model, so it cannot appear in prompt context either.
- **The model can never write.** Actions that would change external state
  (send an email, schedule a meeting, move a deal) are created as `AiAgentAction`
  proposals that expire in 24 hours. Approving one re-checks the permission the
  manual operation would require. This is what keeps a prompt-injected
  instruction — "email everyone that the round is closing" — from ever becoming
  an outbound action.
- **Retrieval respects scope.** Retrieved chunks and tool results are filtered
  by startup membership and the caller's resource permissions.
- Refusals are non-specific, so they do not disclose the existence of a
  protected record or the shape of a role's grants.
- **The caller is told what their own role cannot reach.** Withholding a tool
  stops the copilot reading protected data, but leaves the model with no idea
  why it came up empty — so it guesses, answers from general knowledge, or asks
  the founder to paste the data in. `describeAiAccess` lists the caller's own
  denied read domains and `aiAccessInstructions` renders the prompt block that
  makes the copilot name the missing permission instead. Only the caller's own
  grants are described, which discloses strictly less than the Team & Roles
  page they can already open.

Details in [ai.md](ai.md).

## Reviewing a change for security

Ask these when reviewing:

1. Does every new startup-scoped query carry the tenant in the query itself?
2. Is `requireMember` **and** the right `requirePermission` on the route?
3. Is every new input validated, and every user-supplied URL scheme-refined?
4. Does a cross-tenant attempt look identical to a missing resource?
5. Does anything new get logged that should not be?
6. Does a new endpoint that sends email, spends provider quota, or exposes
   documents have a rate limiter?
7. Is a new secret stored hashed or encrypted, never plaintext?
8. Does a new AI tool have the correct permission requirement — and if it
   writes, is it propose-only?
