# Glossary

Domain vocabulary and the exact values the code uses. When a term appears here,
prefer it over a synonym — consistent naming is part of why the numbers in this
product are trustworthy.

## Product concepts

| Term | Meaning |
|---|---|
| **Workspace / Startup** | The tenant. Almost all business data belongs to exactly one. `Startup` in the schema, "workspace" in the UI |
| **Member** | A `StartupMember` row joining a user to a workspace with a role. Only `status = "active"` is ever authorized |
| **Role** | A per-workspace set of permission grants. Seeded as `owner`, `collaborator`, `viewer`; custom roles are supported |
| **Permission** | A `resource:action` pair such as `documents:share` |
| **Investor** | A contact (`StartupInvestor`). Belongs to the workspace, not to a round |
| **Deal** | An investor placed in a round (`Pipeline`). One investor, one deal per round |
| **Round** | A `FundraisingRound` — the raise being worked |
| **Commitment** | Money an investor has committed against a round, at a given status |
| **Task** | A next step on a deal, with assignee, due date, and priority |
| **Interaction log** | A recorded call, meeting, or email with an investor |
| **Document** | A vault entry; the bytes live in one of its versions |
| **Version** | A `DocumentVersion`. At most one is current per document |
| **Chunk** | A parsed slice of a version, with an embedding, used for retrieval and citations |
| **Page** | A rasterized WebP image of one page, used by previews and the reviewer portal |
| **Reviewer** | An external person holding a data-room invitation. Never a workspace member |
| **Invitation** | A `ReviewerInvitation` — one link, one recipient, its own controls and document allowlist |
| **Artifact** | A structured, renderable AI result attached to a message |
| **Proposal** | An `AiAgentAction` the model created and a human must approve before anything happens |

## Enum values

All defined in `packages/api/src/config/crm.ts` unless noted. Reuse them; never
hardcode the literals.

### Pipeline stages

`sourced` → `contacted` → `meeting_scheduled` → `due_diligence` → `term_sheet`
→ `committed` | `passed`

A new deal may start at any of the first five (`INITIAL_PIPELINE_STAGES`);
`committed` and `passed` are outcomes.

### Investor types

`vc` · `angel` · `family_office` · `accelerator` · `other`

### Round statuses

`draft` · `active` · `closed` · `cancelled`

`OPEN_ROUND_STATUSES` = `draft`, `active` — only these accept new deals. A raise
that is closed or cancelled must not quietly take new outreach.

### Commitment statuses

| Value | Meaning |
|---|---|
| `soft_circled` | A verbal yes with nothing signed |
| `hard_circled` | Documents signed; the money is legally committed |
| `wired` | The money is in the bank |
| `withdrawn` | The commitment was pulled |

`BANKABLE_COMMITMENT_STATUSES` = `hard_circled`, `wired` — the only amounts a
founder may legitimately call raised. The naming is deliberate: vaguer words
like "confirmed" invite a verbal maybe to be filed as money in hand, and a
fundraising tool that lets that happen is worse than a spreadsheet.

### Task statuses and priorities

- Task status: `open` · `completed`
- Priority: `low` · `medium` · `high` — shared by `Task.priority` (urgency) and
  `Pipeline.priority` (deal importance)

### Document processing

- `processingStatus`: `pending_upload` · `processing` · `ready` · `failed`
- `renderStatus`: `pending` · `rendering` · `ready` · `unsupported` · `failed`

`unsupported` is a normal terminal state for XLSX and TXT: still valid vault and
AI documents, but not shareable through the reviewer portal, which serves page
images.

### Notification types

`team_invite` · `task_assigned` · `task_due_today` · `task_overdue` ·
`lead_stale` · `deal_no_next_step` · `followup_due` · `chat_mention` ·
`direct_message` · `reviewer_opened` · `reviewer_comment` · `forward_suspected`

Defined in `services/notification.service.ts`.

### Audit actions

`create` · `update` · `delete` · `revoke` · `archive` · `login` · `logout` ·
`accept` · `decline` · `share` · `view` · `download`

Defined in `services/audit-writer.ts` as `AUDIT_ACTIONS`; extensible with a
string.

### AI analysis rubric (`pitch-deck.v1`)

- **Sections**: `problem`, `solution`, `target_customer`, `market`,
  `business_model`, `traction`, `go_to_market`, `competition`, and more
- **Gap status**: `supported` · `partial` · `missing` · `conflicting`
- **Severity**: `low` · `medium` · `high` · `critical`
- **Score weights**: narrative 40, market validation 35, financial 25

Defined in `config/ai-rubric.ts`.

## Technical terms

| Term | Meaning here |
|---|---|
| **Tenant scoping** | Carrying `startupId` inside the query, not just in middleware |
| **Composite selector** | `where: { startupId_id: { startupId, id } }` — the standard scoped read |
| **Session family** | A chain of refresh tokens sharing a `familyId`. Revoking the family kills the session |
| **Token reuse detection** | Replaying an already-revoked refresh token revokes the whole family |
| **Cron lock** | A Redis `SET NX` key bucketed by wall-clock interval, so only one API replica runs each tick |
| **Realtime bus** | Redis pub/sub fan-out for per-user SSE events |
| **Run registry** | Redis state making an in-flight AI generation visible and cancellable across replicas |
| **Client nonce** | A per-message id the chat client reuses on retry; the database's uniqueness constraint makes sends idempotent |
| **Page token** | A short-lived HMAC authorizing one reviewer session to read pages of one document version |
| **Propose-only** | The AI pattern where a tool writes a proposal a human must approve, never the effect itself |
| **Promotion** | Making a document version current, once both processing pipelines reach a usable terminal state |
| **Forward suspicion** | Two or more distinct hashed devices or IPs on one reviewer invitation — a signal, not proof |
| **Bankable** | A commitment at `hard_circled` or better |

## Naming in the repository

| Thing | Convention | Example |
|---|---|---|
| Workspace packages | `@raise/<name>` | `@raise/api`, `@raise/web` |
| API route files | `<resource>.routes.ts` | `investor.routes.ts` |
| Services | `<resource>.service.ts`, exported as a singleton | `investorService` |
| Validators | `<resource>.schemas.ts` | `investor.schemas.ts` |
| Workers | `<queue>.worker.ts` | `document-rasterize.worker.ts` |
| Database tables | `snake_case` plural via `@@map` | `startup_investors` |
| Query keys | Built through `qk` in `lib/query-keys.ts` | `qk.pipeline(startupId, roundId)` |

Note: the product is named **Raise** and the npm workspaces use `@raise/*`,
while some user-facing copy and the repository directory still say **FP
Founders**. Both refer to the same product.
