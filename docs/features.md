# Feature guide

What Raise does, module by module: the user-facing behavior, the permission it
needs, and where the code lives. This is the orientation page — the mechanism
behind each feature is in the linked subsystem docs.

## The product in one paragraph

Raise is a fundraising workspace for startup teams. A founder plans a round,
builds a list of investors, works each one through a deal pipeline, records
every interaction, tracks commitments against a target, shares fundraising
documents through controlled external data-room links, coordinates the team in
chat attached to those same records, and uses an AI copilot grounded in the
workspace's own data. Every workspace is a separate tenant with its own roles
and audit trail.

## Modules at a glance

| Module | Route | Permission | Code |
|---|---|---|---|
| Dashboard | `/dashboard` | member | `pages/dashboard/Dashboard.tsx` |
| Pipeline | `/pipeline` | `pipeline:read` | `pages/dashboard/Pipeline/` |
| Investors | `/investors` | `pipeline:read` | `pages/dashboard/Investors/` |
| Fundraising | `/fundraising` | `financial:read` | `pages/dashboard/Fundraising/` |
| Documents | `/documents` | `documents:read` | `pages/dashboard/Documents/` |
| Reviewers | `/reviewers` | `documents:read` / `documents:share` | `pages/dashboard/Reviewers.tsx` |
| Team chat | `/chat` | `chat:read` | `pages/dashboard/Chat/` |
| AI copilot | `/ai` | `ai_reports:read` | `pages/dashboard/Ai/` |
| Team | `/team` | `team:read` | `pages/dashboard/Team/` |
| Audit | `/audit` | `startup:read` | `pages/dashboard/Audit/` |
| Startup profile | `/startup` | `startup:read` | `pages/dashboard/Startup.tsx` |
| Notifications | `/notifications` | member | `pages/dashboard/Notifications/` |
| Settings / Profile | `/settings`, `/profile` | session | `Settings.tsx`, `Profile.tsx` |
| Reviewer portal | `/review/:token` | reviewer session | `pages/review/` |

## Accounts and workspaces

**Sign up** with email and password (confirmed by an emailed OTP) or with
Google. **Sign in** the same two ways, plus password recovery by emailed link.

A user can belong to **several workspaces** and switches between them from the
sidebar. The choice is remembered two ways: locally as a Zustand preference,
and server-side via `PUT /startups/:startupId/activate`, so it follows the user
to another device.

Someone with no workspace still lands on the dashboard — that is where they
create one or accept an invitation. Every other screen is behind
`RequireWorkspace`.

**Team management** (`/team`): invite by email, resend or revoke an invitation,
change a member's role, remove a member. The seeded roles are `owner`,
`collaborator`, and `viewer`; a workspace can also define custom roles with
`team:manage`. Matrix in [security.md](security.md#permission-matrix).

## Dashboard

The landing surface: round progress, pipeline summary, deals needing attention,
upcoming and overdue tasks, and recent activity. It reads the same queries the
detail screens use, through shared keys in `lib/query-keys.ts`, so a change made
anywhere is reflected everywhere without a refresh.

## Investors (CRM)

A directory of investor contacts scoped to the workspace.

- Profile fields: firm, investor type, sector and stage focus, geography, check
  size range, portfolio highlights, warm-intro path, LinkedIn.
- **`description` and `notes` are separate on purpose.** `description` is the
  stable "who is this investor" profile; `notes` is a running human scratchpad
  that churns. Keeping them apart is what stops the AI copilot from quoting a
  two-month-old scratch note as if it were fact. Notes carry author and edit
  attribution.
- Search matches token-by-token across name, email, firm, sector, and
  description, so "Sara Chen" still finds "Sarah Chen".
- Filters: investor type, stage, engagement (engaged vs prospect), round, owner.
- An investor can be in several rounds, but only once per round.
- With the Google integration connected: send an email or schedule a meeting
  directly from the investor, each behind its own rate limiter.

`pipeline:*` · code: `pages/dashboard/Investors/`, API `/startups/:startupId/investors`

## Pipeline (deals)

The round's working board. A **deal** is an investor placed in a round.

- Stages: `sourced → contacted → meeting_scheduled → due_diligence →
  term_sheet → committed | passed`.
- Drag-and-drop board (dnd-kit) with a dedicated mobile layout. Card order uses
  a float `sortOrder` so a card can drop between two others without renumbering
  the column.
- Per-deal: expected amount, close probability, owner, priority, lead flag, and
  an investor fit score.
- Every stage move appends a `PipelineStageEvent`, so the history is
  reconstructable and the funnel analytics are real rather than derived from
  current state.
- **Focus list** surfaces deals needing attention; `deal-signals.ts` computes
  the signals (stale, no next step, overdue task).
- **Tasks** live on the deal — assignee, due date, priority, open/completed.
- **Interaction logs** record calls, meetings, and emails against the investor
  and the deal.
- A **discussion tab** links the deal to team chat.
- Analytics view: funnel, stage conversion, and time-in-stage.
- Committing a deal creates a `Commitment`; passing captures a reason.

`pipeline:*` · code: `pages/dashboard/Pipeline/`, API `/startups/:startupId/pipeline`

## Fundraising

Rounds and the money against them.

- A round has a name, target amount, minimum ticket, equity offered, currency,
  status (`draft`, `active`, `closed`, `cancelled`), and first/target close
  dates. Only `draft` and `active` rounds accept new deals.
- **Commitments** are the honest ledger. Statuses are named after what they
  legally mean: `soft_circled` (a verbal yes with nothing signed),
  `hard_circled` (docs signed), `wired` (money in the bank), `withdrawn`. Only
  `hard_circled` and `wired` count as raised. Vaguer wording invites a verbal
  maybe to be filed as money in hand.
- Every status change appends a `CommitmentStatusEvent`.
- Round metrics and a funding-history chart, with a per-startup remembered time
  range.
- A forecast service projects round close from pipeline state; the AI copilot
  can call it as a tool.

`financial:*` · code: `pages/dashboard/Fundraising/`, API `/startups/:startupId/fundraising-rounds` and `/commitments`

## Documents

A versioned vault for fundraising material — decks, cap tables, financial
models, and supporting files.

- Accepted types: PDF, DOCX, XLSX, PPTX, and plain text, up to 20 MB.
- **Every document is versioned.** Uploading a new version does not overwrite
  the old one; exactly one version is current at a time, enforced by a database
  partial unique index.
- Processing per version: parse → chunk → embed (when configured) → rasterize
  pages. Status is visible in the UI, and a failed version can be retried.
- Page-image previews mean a document can be read without handing out the
  source file.
- Archive and restore rather than delete, with permanent delete available.
- Per-document analytics show reviewer engagement.
- Documents can be attached to AI chat sessions and `@`-mentioned in team chat.

`documents:*` · code: `pages/dashboard/Documents/` · mechanism: [documents.md](documents.md)

## Reviewer data room

Controlled external sharing — how a deck reaches an investor without becoming a
forwarded PDF.

The founder creates an invitation choosing exactly which document versions are
included and how the link behaves: expiry, allowed email domains, download
on/off, print on/off, watermarking, screenshot guard, notify-on-open, and an
optional click-through NDA.

The reviewer opens the link, verifies by email OTP, accepts the NDA if
required, and reads **rendered, watermarked page images** — the portal never
exposes a URL to the source file. They can leave comments tied to a document
version.

The founder gets an engagement view: who opened it, which pages, for how long,
completion percentage, suspected forwarding, and copy/print/screenshot events,
plus a comment inbox with read and resolve states. Links can be revoked or
resent at any time.

`documents:read` to view, `documents:share` to create or revoke · code:
`pages/dashboard/Reviewers.tsx`, `pages/review/` · mechanism:
[reviewer-portal.md](reviewer-portal.md)

## Team chat

Real-time collaboration attached to the fundraising records rather than beside
them.

- Channels and direct messages, threaded replies, emoji reactions, editing,
  and tombstoned deletes (never hard deletes, so threads stay coherent).
- **Entity mentions**: `@` a teammate, a deal, an investor, a document, or a
  round. Mentions render as unfurled cards linking back to the record.
- Unread counts and read cursors per conversation; per-conversation
  notification level; typing indicators; channel archive and restore.
- Sends are optimistic and idempotent: a retry reuses the same `clientNonce`, so
  a send that actually succeeded cannot duplicate.
- Delivered over the same SSE stream as notifications — one live connection per
  user, not two.

`chat:read`, `chat:create`, `chat:manage` · code: `pages/dashboard/Chat/`

## AI copilot

Two capabilities, both gated by `AI_ENABLED`.

**Conversational copilot** — a streaming chat grounded in the workspace's own
data. It retrieves document chunks by vector similarity and calls server-owned
tools for pipeline, round, investor, task, reviewer-engagement, and team-chat
context. Answers carry citations back to the source. It can produce artifacts:
sourced answers, comparisons, email drafts, meeting briefs, and investor briefs.

**Pitch-deck analysis** — a rubric-scored review of a document version:
executive summary, scores (narrative, market validation, financial, confidence),
strengths, gaps with severity, and investor personas with the questions each
would ask. Every finding links to the evidence chunk behind it. Runs as a
background job with per-workspace daily and queue caps.

Two properties define the design:

- **Tools are an allowlist derived from the caller's role.** No permission, no
  tool, and no data in prompt context either.
- **The model never writes.** Anything that would change external state becomes
  a proposal a human approves — and approving re-checks the permission the
  manual action would need.

`ai_reports:read`, `ai_reports:create` · code: `pages/dashboard/Ai/` · mechanism:
[ai.md](ai.md)

## Notifications

In-app feed plus live delivery over SSE. Types:

| Type | Fires when |
|---|---|
| `team_invite` | You are invited to a workspace |
| `task_assigned` | A task is assigned to you |
| `task_due_today` / `task_overdue` | Daily reminder pass |
| `lead_stale` | A lead has not moved in too long |
| `deal_no_next_step` | An active deal has no next step |
| `followup_due` | A follow-up comes due |
| `chat_mention` / `direct_message` | You are mentioned or DM'd |
| `reviewer_opened` | A reviewer opens a shared link |
| `reviewer_comment` | A reviewer leaves a comment |
| `forward_suspected` | Reviewer signals suggest a link was forwarded |

Notifications are persisted first and published second, so a missed SSE frame
is recovered by the next refetch.

## Audit trail

`/audit` is a filterable, paginated record of who did what: create, update,
delete, revoke, archive, share, view, download, plus login/logout and password
changes. Filter facets are served by the API, and the view exports to CSV.

Audit writes are best effort by design — a failed audit insert must never roll
back the business mutation it describes.

`startup:read` · code: `pages/dashboard/Audit/`

## Integrations

**Google Calendar and Gmail**, per user, connected from Settings. Requested
scopes are `openid`, `email`, `calendar.events`, and `gmail.send` — sensitive
tier, deliberately not restricted tier, which keeps the integration usable
without an annual third-party security assessment.

With it connected: schedule an investor meeting as a real calendar event, send
investor email from the founder's own Gmail address, and sync calendar events
back into interaction logs every 30 minutes. Refresh tokens are encrypted at
rest with AES-256-GCM.

Requires the full Google integration variable group. Sign-in with Google is a
separate feature needing only `GOOGLE_CLIENT_ID`.

## Public pages

`/`, `/pricing`, and `/about` are the marketing surface, rendered by the same
app and reachable without a session.
