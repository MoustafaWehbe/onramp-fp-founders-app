# Plan: Unified AI Fundraising Copilot

Last updated: 2026-08-17  
Project: `onramp-fp-founders-app`  
Status: implementation plan; AI product frontend and backend do not exist yet

## 1. Purpose

Build one unified AI page where a startup team can talk with an AI assistant and request analyses without switching between separate “AI Chat” and “AI Analysis” products.

The assistant should answer questions using the startup's own documents and fundraising records, produce structured pitch-deck analyses, simulate investor questions, and explain fundraising risks. It must show where grounded answers came from and must never expose another startup's data.

This plan intentionally does **not** use the existing AI frontend placeholder as a product or architecture reference. The AI frontend and backend are greenfield. The existing AI database tables are an initial schema proposal that may be migrated before any production data depends on them.

## 2. Current State

### 2.1 Implemented and reusable

The working application already provides the following inputs:

- Startup profiles, members, roles, and fine-grained permissions.
- Investor contacts, notes, ownership, and interaction history.
- Round-scoped pipeline entries, stage history, probabilities, priorities, and lead flags.
- Tasks, due dates, assignments, and a deterministic pipeline focus list.
- Fundraising rounds, commitments, commitment history, and server-computed round metrics.
- Versioned data-room documents.
- Document parsing into Markdown and overlapping chunks.
- OpenAI embeddings for document chunks stored in PostgreSQL with pgvector.
- Reviewer invitations, comments, page engagement, completion, and security signals.
- Gmail sending and Google Calendar synchronization.
- BullMQ/Redis background jobs.
- TanStack Query, React Router, and the existing UI component system.

### 2.2 AI-specific items that exist only as groundwork

Prisma currently contains these placeholder models:

- `AiAnalysis`
- `AiGapAnalysis`
- `InvestorPersona`
- `PersonaQuestion`
- `AiChatSession`
- `AiChatMessage`

These tables do not mean the AI modules are implemented. There are currently no AI routes, validators, controllers, chat services, analysis workers, generation calls, streaming APIs, retrieval queries, or real AI frontend.

The document-processing and embedding workers are useful prerequisites, but they are not a completed AI feature.

### 2.3 Known technical gaps

- No generation model or model-selection configuration exists.
- No vector similarity search exists even though embeddings are stored.
- No pgvector HNSW/IVFFlat index exists.
- AI chat sessions cannot hold multiple pinned documents or analyses cleanly.
- AI messages cannot store citations, tool calls, errors, structured output, or token usage.
- AI analyses do not store analysis type, rubric version, model, timestamps, requester, errors, or evidence.
- Document chunks have section and character offsets, but `pageNumber` is not reliably populated. Do not claim exact page citations when it is null.
- Existing AI navigation is inconsistent. It must be replaced by one `/ai` route when the new page is built.

## 3. Product Decisions

These decisions are part of the plan unless the product owner changes them before implementation.

1. **One AI surface:** one sidebar item and one route, `/ai`.
2. **Conversation is the primary interface:** analysis is requested inside a conversation and returned as a structured artifact in that conversation.
3. **AI and team chat remain separate:** `/chat` continues to be human workspace chat. `/ai` is the private AI copilot.
4. **Private sessions for v1:** a session belongs to the creating user. Generated reports may be shared later; silently sharing complete prompts with the workspace is not acceptable.
5. **Read-only first release:** AI may answer, analyze, recommend, and draft. It may not send emails, move deals, modify commitments, or create tasks.
6. **Explicit context:** the UI always shows which round, documents, and optional investor are in context.
7. **Workspace-aware, retrieval-driven:** selecting “Workspace” does not dump the whole database into a prompt. The assistant calls approved read-only tools as needed.
8. **Grounded claims require sources:** answers about uploaded documents or application records include citations or record references.
9. **Version pinning:** a deck analysis belongs to the exact `DocumentVersion` analyzed. A new upload does not rewrite an old analysis.
10. **No autonomous actions:** future write operations require a preview and explicit confirmation for every operation.
11. **Schema changes are authorized:** implementation is not constrained to the current AI tables. Add or reshape tables, columns, indexes, and relations when they materially improve correctness, tenant isolation, citations, observability, or maintainability. All changes still require a reviewed Prisma migration and tests.
12. **Typed generative UI, never arbitrary UI:** the assistant may select from a versioned registry of predefined, polished UI artifacts that match its available capabilities. It may not emit HTML, JSX, CSS, arbitrary component names, arbitrary links, or unregistered actions.

## 4. User Outcomes

The first complete product should let a founder:

1. Start a new AI conversation.
2. Select one or more ready documents and optionally a fundraising round.
3. Ask questions about selected documents and receive cited answers.
4. Request a structured pitch-deck analysis.
5. Ask follow-up questions about any score or recommendation.
6. Start an investor-persona rehearsal based on that analysis.
7. Ask questions about the active round, pipeline, tasks, commitments, or a specific investor.
8. Receive a meeting brief or follow-up email draft without sending anything.
9. Return to previous conversations and saved analyses.

Representative prompts:

- “Summarize the current pitch deck in five bullets.”
- “What evidence supports our go-to-market claim?”
- “Analyze this deck and prioritize the five biggest gaps.”
- “Challenge me as a seed-stage fintech investor.”
- “Why did the financial score receive 58?”
- “How healthy is our seed round?”
- “Which investors need attention today, and why?”
- “Prepare me for tomorrow's meeting with North Ventures.”
- “Draft a follow-up based on our previous interactions.”

## 5. Scope by Release

### 5.1 Release 1: grounded document copilot

Required:

- New unified `/ai` page.
- Create, list, rename, archive/delete, and resume private sessions.
- Pin one or more document versions to a session.
- Stream assistant messages.
- Vector retrieval scoped to the startup and pinned document versions.
- Document/section citations.
- Starter prompts and clear empty/error states.
- Usage, latency, failure, and model metadata.

Exit condition: a user can ask a question about a ready document, receive a grounded streaming answer with valid sources, reload the page, and reopen the conversation.

### 5.2 Release 2: structured deck analysis and pitch rehearsal

Required:

- Queue a deck analysis from the same conversation.
- Show progress and failure states.
- Persist scores, summary, strengths, gaps, recommendations, evidence, and confidence.
- Render an analysis artifact inside the conversation and in the context panel.
- Generate investor personas and suggested questions.
- Continue chatting about the analysis.
- Re-run an analysis without overwriting the previous result.

Exit condition: a user can analyze a specific deck version, inspect every recommendation and its evidence, and rehearse with a generated investor persona.

### 5.3 Release 3: structured fundraising copilot

Required read-only tools:

- Startup profile.
- Active or selected round health.
- Pipeline summary and deterministic analytics.
- Pipeline focus list.
- Investor record and interaction history.
- Open tasks.
- Commitments and at-risk commitments.
- Reviewer engagement and comments.

Exit condition: the assistant can answer application-data questions using server-owned tools, preserve permission boundaries, and link users to the relevant record.

### 5.4 Release 4: drafts and confirmed actions

First add drafts:

- Investor meeting briefs.
- Follow-up email drafts.
- Suggested task lists.
- Weekly fundraising summaries.

Only after read-only quality is proven, consider confirmed actions:

- Create a task.
- Update an investor note.
- Send a Gmail message.

Every write action must show a preview, identify affected records, require explicit confirmation, use the caller's normal permission checks, and write an audit event.

## 6. Explicit Non-Goals

Do not include these in the first three releases:

- Discovering investors outside the startup's stored contacts.
- External investor matching.
- Live competitor or market research.
- Verifying market-size claims against the internet.
- Fully autonomous fundraising workflows.
- Automatic email sending or pipeline mutation.
- Training or fine-tuning a custom model.
- Voice input/output. It can be added later without changing the core chat design.
- Claims of exact page-level citations until parsing reliably maps chunks to pages.

External research and investor discovery require new, approved data sources and a separate privacy/cost plan.

## 7. Target Architecture

### 7.1 Request paths

Interactive chat:

```text
React AI page
  -> POST message endpoint
  -> authenticate + requireMember + AI permission
  -> load session and validate ownership/startup
  -> select allowed read-only tools
  -> retrieve document chunks and/or execute structured tools
  -> stream assistant response
  -> persist message, citations, tool metadata, and usage
```

Deck analysis:

```text
React AI page
  -> POST analysis endpoint
  -> validate document version and permissions
  -> create queued AiAnalysis
  -> enqueue BullMQ job
  -> worker loads extracted document content
  -> worker runs extraction + scoring + recommendation stages
  -> transactionally persists analysis, gaps, personas, questions, and evidence
  -> UI receives status through polling initially; SSE can replace polling later
```

### 7.2 Provider boundary

Create a provider adapter rather than importing the OpenAI client throughout controllers and services.

The adapter must expose application-level operations such as:

- `streamConversation()`
- `generateStructuredObject()`
- `embedQuery()`

The adapter owns provider request formatting, timeouts, retries, abort handling, model names, and usage extraction. Business services own prompts, tools, validation, permissions, and persistence.

Do not allow provider response shapes to leak into API contracts or Prisma models.

### 7.3 Model configuration

Add environment-driven configuration for:

- Chat model.
- Structured-analysis model.
- Embedding model.
- Per-request timeout.
- Maximum output tokens.
- Maximum tool rounds.
- Retrieval result count.
- Minimum retrieval score.
- AI feature flag.

Use the existing 1,536-dimension embedding model for query embeddings unless a migration is intentionally planned. A model producing a different vector size cannot be substituted without re-embedding all chunks and changing the column.

Model selection is an implementation decision that should be benchmarked with the evaluation set in section 15. Do not hardcode model names in controllers or workers.

## 8. Database Changes

Create one Prisma migration before implementing endpoints. Because the AI tables are not in production use yet, favor a clean relationship model over preserving an awkward placeholder design.

### 8.1 `AiChatSession`

Add:

- `title String?`
- `roundId String?`
- `lastMessageAt DateTime?`
- `updatedAt DateTime @updatedAt`
- `archivedAt DateTime?`
- `contextMode String` with an initial vocabulary such as `workspace` or `selected`

Add indexes:

- `(startupId, userId, archivedAt, lastMessageAt)`
- `(startupId, id)` unique composite key

Add an optional round relation scoped through `[roundId, startupId]`.

Remove the assumption that a session has only one `documentId` or one `analysisId`.

### 8.2 Session document join

Create `AiChatSessionDocument`:

- `id`
- `sessionId`
- `documentId`
- `documentVersionId`
- `createdAt`

Constraints:

- Unique `(sessionId, documentVersionId)`.
- The document version must belong to the document.
- Service validation must ensure the document belongs to the session's startup.

Pin a version rather than only a document so historical answers remain reproducible after a new file upload.

### 8.3 `AiChatMessage`

Add:

- `status`: `pending | streaming | completed | failed | cancelled`
- `model String?`
- `structuredContent Json?`
- `errorCode String?`
- `errorMessage String?`
- `inputTokens Int?`
- `outputTokens Int?`
- `latencyMs Int?`
- `completedAt DateTime?`

Validate the role vocabulary in the API. Do not accept arbitrary client-created assistant or tool messages.

Add `(sessionId, createdAt)` index.

### 8.4 Citations

Create `AiCitation`:

- `id`
- `messageId`
- `sourceType`
- `sourceId`
- `documentChunkId String?`
- `label`
- `excerpt String?`
- `metadata Json?`
- `sortOrder`
- `createdAt`

Initial source types:

- `document_chunk`
- `startup`
- `round`
- `pipeline`
- `investor`
- `interaction`
- `task`
- `commitment`
- `reviewer_analytics`

The client receives safe labels and deep-link metadata, not raw internal prompts.

### 8.5 Tool-call records

Create `AiToolCall` or store an equivalent normalized record:

- `messageId`
- `toolName`
- `arguments Json`
- `status`
- `durationMs`
- `errorCode String?`
- `resultSummary Json?`

Do not persist secrets, complete document contents, email tokens, or unnecessarily large tool results.

### 8.6 AI run and usage records

Create `AiRun` as the canonical record for every provider generation request. This avoids splitting quota, cost, and failure reporting across chat-message and analysis tables.

Fields:

- `id`
- `startupId`
- `userId`
- `sessionId String?`
- `messageId String?`
- `analysisId String?`
- `operationType`: initially `chat | analysis_extract | analysis_score | analysis_personas | title | summary`
- `provider`
- `model`
- `providerRequestId String?`
- `status`: `started | completed | failed | cancelled`
- `inputTokens Int?`
- `cachedInputTokens Int?`
- `outputTokens Int?`
- `latencyMs Int?`
- `estimatedCostMicros BigInt?`
- `errorCode String?`
- `startedAt`
- `completedAt DateTime?`
- `createdAt`

Indexes:

- `(startupId, createdAt)` for workspace quotas and reporting.
- `(userId, createdAt)` for per-user limits.
- `(sessionId, createdAt)`.
- `(analysisId, createdAt)`.
- `(status, createdAt)` for operational cleanup and stuck-run detection.

`estimatedCostMicros` is optional and calculated from versioned server-side pricing configuration when available. Never use a floating-point currency column.

Chat messages may keep model/token/latency summary columns for convenient API reads, but `AiRun` is the source of truth for quotas and cost reporting. One user-visible assistant message or one deck analysis may involve multiple runs.

### 8.7 `AiAnalysis`

Add:

- `sessionId String?`
- `requestedBy String`
- `analysisType` initially `pitch_deck`
- `schemaVersion`
- `rubricVersion`
- `model String?`
- `confidenceScore Int?`
- `result Json?` for versioned structured output that does not deserve a new table for every iteration
- `queuedAt`
- `startedAt DateTime?`
- `completedAt DateTime?`
- `updatedAt DateTime @updatedAt`
- `errorCode String?`
- `errorMessage String?`

Keep normalized score fields and existing gap/persona/question tables because they support filtering and stable UI rendering. Use `result` for secondary structured sections such as strengths, extracted claims, and evidence maps.

Allowed status vocabulary:

- `queued`
- `processing`
- `completed`
- `failed`
- `cancelled`

Add indexes:

- `(startupId, documentVersionId, createdAt)`
- `(startupId, sessionId, createdAt)`
- `(startupId, status, createdAt)`

### 8.8 Analysis evidence

Create `AiAnalysisEvidence` so analysis findings and recommendations can cite exact source chunks independently of chat messages.

Fields:

- `id`
- `analysisId`
- `gapAnalysisId String?`
- `documentChunkId`
- `evidenceType`: `strength | gap | score | extracted_claim | persona_question`
- `label`
- `excerpt String?`
- `sortOrder`
- `createdAt`

Constraints and behavior:

- The chunk must belong to the analyzed `DocumentVersion`; enforce this in the service and cover it with tests.
- Deleting an analysis cascades to its evidence.
- Deleting a document version already cascades through the analysis and chunks.
- Store only bounded excerpts; the chunk relation remains the canonical source.
- A gap may have zero evidence only when the finding is explicitly “information missing.”

### 8.9 Persisted UI artifacts

Create `AiArtifact` to persist structured results that have a richer presentation than ordinary Markdown messages.

Fields:

- `id`
- `startupId`
- `sessionId`
- `messageId`
- `analysisId String?`
- `artifactType`
- `schemaVersion`
- `title String?`
- `status`: `building | ready | failed`
- `data Json`
- `createdAt`
- `updatedAt`

Indexes and constraints:

- `(startupId, sessionId, createdAt)`.
- `(messageId, createdAt)`.
- `(analysisId, createdAt)`.
- Every lookup is startup-scoped even though the artifact is reachable through a session.
- Deleting a message/session cascades to its artifacts.

`artifactType` must come from the server registry described in section 13.8. `data` must pass the matching versioned Zod schema before persistence and again before rendering. Prefer stable record IDs and compact presentation snapshots over copying large tool responses.

Artifacts are immutable after reaching `ready`, except for narrowly defined presentation metadata. A refreshed round-health answer creates a new artifact rather than silently changing the historical answer.

### 8.10 Vector index

Add a raw SQL migration for an appropriate pgvector cosine index on `document_chunks.embedding`. Confirm the installed pgvector version and expected dataset size before choosing HNSW parameters.

The similarity query must still filter through:

`DocumentChunk -> DocumentVersion -> Document -> startupId`

An index is a performance aid, not a tenant boundary.

## 9. Backend Modules

Follow the repository's normal route -> middleware -> controller -> service -> validator layering.

### 9.1 New files

Recommended structure:

```text
packages/api/src/
  config/ai.ts
  validators/ai.schemas.ts
  routes/ai.routes.ts
  controllers/ai.controller.ts
  services/ai-provider.service.ts
  services/ai-chat.service.ts
  services/ai-retrieval.service.ts
  services/ai-context.service.ts
  services/ai-analysis.service.ts
  services/ai-tools.service.ts
  jobs/workers/ai-analysis.worker.ts
```

If any service grows beyond a manageable size, move the AI services into `services/ai/` as one deliberate refactor. Do not mix both layouts randomly.

Also update:

- `packages/api/src/routes/startup.routes.ts`
- `packages/api/src/jobs/queue.ts`
- `packages/api/src/jobs/workers/index.ts`
- `packages/api/src/config/env.ts`
- `packages/api/src/config/permissions.ts` if permission semantics change
- `packages/api/openapi.yaml`
- `packages/api/.env.example`

### 9.2 API endpoints

Mount under `/api/v1/startups/:startupId/ai`.

Sessions:

```text
GET    /sessions
POST   /sessions
GET    /sessions/:sessionId
PATCH  /sessions/:sessionId
DELETE /sessions/:sessionId
POST   /sessions/:sessionId/messages
GET    /sessions/:sessionId/messages/:messageId/stream
POST   /sessions/:sessionId/cancel
PUT    /sessions/:sessionId/context
```

Analyses:

```text
GET    /analyses
POST   /analyses
GET    /analyses/:analysisId
POST   /analyses/:analysisId/cancel
```

Context discovery:

```text
GET    /context/documents
GET    /context/rounds
GET    /context/investors?search=...
```

The existing resource endpoints may be reused by the frontend when their response shape is sufficient; do not create duplicate AI context endpoints without a reason.

### 9.3 Streaming contract

Use SSE for chat and artifact progress. Use a two-step request so the write is idempotent and the stream is a reconnectable GET:

1. `POST /sessions/:sessionId/messages` validates and persists the user message plus a pending assistant message, then returns `202` with `assistantMessageId` and `streamUrl`.
2. `GET /sessions/:sessionId/messages/:messageId/stream` opens the SSE stream using cookie authentication.
3. The server atomically claims a pending assistant message before starting generation. A second connection subscribes to the existing run; it never starts a duplicate model request.
4. The final assistant message and artifacts are persisted before the terminal event is emitted.

Use a short-lived Redis Stream or equivalent replay buffer keyed by assistant message ID. Give every event a monotonically increasing `id`. On reconnect, the browser sends `Last-Event-ID`; replay newer events and then continue live. The database remains the durable source of the final message and artifact, while Redis only supports in-progress replay.

If the replay buffer has expired, return the durable current message state. If generation is still running but replay is unavailable, emit a snapshot event and continue with new events. Never restart generation merely because a browser reconnects.

Events should be application-owned and versionable:

- `stream.ready`
- `message.started`
- `message.delta`
- `tool.started`
- `tool.completed`
- `citation.added`
- `artifact.started`
- `artifact.ready`
- `artifact.failed`
- `message.snapshot`
- `message.completed`
- `message.failed`
- `message.cancelled`

Each SSE event uses a shared envelope:

```json
{
  "version": 1,
  "sessionId": "...",
  "messageId": "...",
  "sequence": 12,
  "timestamp": "...",
  "payload": {}
}
```

Transport requirements:

- `Content-Type: text/event-stream; charset=utf-8`.
- `Cache-Control: no-cache, no-transform`.
- `Connection: keep-alive` where the hosting platform allows it.
- Disable reverse-proxy buffering, including `X-Accel-Buffering: no` where applicable.
- Flush headers immediately.
- Send a comment heartbeat approximately every 15 seconds while no application event is emitted.
- Keep heartbeats free of sensitive data and do not persist them.
- Use monotonic sequence IDs and preserve event ordering per assistant message.
- Bound each event size; send text in reasonable deltas rather than one event per token.
- Abort provider work when cancellation is requested and no other server-side consumer needs it.
- Detect stale `streaming` messages and repair them to a terminal failed state through a scheduled cleanup.

Closing a browser tab or temporarily losing the network is not the same as cancelling the model run. A disconnect leaves the run active for a short bounded period so the client can reconnect. The explicit cancel endpoint is authoritative.

Do not expose provider-native event objects directly to the browser.

### 9.4 Session behavior

- Only the session owner can read or modify a v1 session.
- Every lookup uses both `startupId` and `sessionId`.
- Session creation validates pinned document versions and optional round.
- First user message may generate the title asynchronously; failure to title must not fail chat.
- List sessions newest activity first.
- Archive by default. Hard deletion is optional and should cascade citations/tool records safely.
- Limit conversation history by a token budget. Summarize older turns when needed rather than sending an unbounded transcript.

## 10. Document Retrieval

### 10.1 Retrieval algorithm for v1

1. Validate session ownership and selected document versions.
2. Generate the query embedding with the same embedding model/dimension used for chunks.
3. Execute a parameterized pgvector cosine query.
4. Join through documents and filter by `startupId` before ranking results.
5. If documents are pinned, restrict results to those exact version IDs.
6. Exclude chunks with null embeddings or versions that are not ready.
7. Fetch a small candidate set, remove near-duplicates caused by chunk overlap, and return the best chunks within a context-token budget.
8. Include document title, version, section label, chunk ID, and safe location metadata.
9. Require the assistant to attach citations to claims derived from retrieved chunks.

All raw SQL values must be parameterized. Do not interpolate IDs, query text, or vector literals into SQL strings.

### 10.2 Citation rules

- If `pageNumber` exists, the UI may display it.
- If it is null, display document title, version, and section label.
- Never invent a page number.
- Store a short excerpt for auditability, bounded to a safe maximum length.
- Clicking a citation should open the existing document viewer at the best available location.
- If an answer cannot be supported by retrieved material, the assistant should say that the selected documents do not provide enough evidence.

### 10.3 Retrieval quality follow-up

After vector retrieval works, evaluate hybrid retrieval using PostgreSQL full-text search plus vector similarity. Add it only if the evaluation set shows material improvement for exact terms, names, and financial figures.

## 11. Structured Application Tools

The assistant must not generate arbitrary SQL or receive a generic database query tool. Implement explicit, read-only tools with bounded schemas.

Initial tools:

### `get_startup_profile`

Returns safe startup fields such as name, description, industry, website, and funding stage.

### `get_round_health`

Calls the existing fundraising metrics service and returns target, wired, hard-circled, soft-circled, remaining gap, weighted pipeline, days to close, and at-risk commitments.

The AI explains these server-computed values. It must not independently redefine “raised.”

### `get_pipeline_summary`

Uses existing pipeline analytics: counts, value, funnel reach, conversion, velocity, outcomes, and win rate.

### `get_focus_deals`

Uses the deterministic focus service for overdue tasks, quiet deals, deals with no task, and high-priority items. The AI may prioritize or explain the results but should not recreate the qualification logic.

### `get_investor_context`

Returns one startup-scoped investor, relevant round pipeline entries, stage events, tasks, commitments, notes, and recent interactions. Enforce result size limits.

### `get_reviewer_engagement`

Returns document or invitation engagement summaries, comments, page engagement, completion, and carefully worded forwarding signals.

### Permission intersection

`ai_reports:read` alone is not sufficient authorization for every tool.

- Document search requires `documents:read`.
- Pipeline/investor/task tools require `pipeline:read`.
- Round and commitment tools require `financial:read`.
- Reviewer engagement requires the appropriate document/reviewer permission chosen during implementation.

The server decides which tools are available for each request. The model must never be trusted to enforce authorization.

## 12. Pitch-Deck Analysis Pipeline

### 12.1 Preconditions

- The requested document belongs to the startup.
- The version belongs to that document.
- The version is current or explicitly selected.
- `processingStatus` is `ready`.
- Extracted chunks exist.
- Caller has `documents:read` and `ai_reports:create`.

Embeddings are desirable for follow-up retrieval but are not required to analyze the complete extracted deck.

### 12.2 Analysis stages

Use a versioned rubric stored in code.

1. **Content extraction**
   - Problem
   - Solution/product
   - Target customer
   - Market
   - Business model
   - Traction
   - Go-to-market
   - Competition/differentiation
   - Team
   - Financials/unit economics
   - Funding ask and use of funds

2. **Evidence assessment**
   - Identify which claims are supported by numbers or concrete evidence.
   - Mark missing information as missing, not false.
   - Record source chunk IDs for major findings.

3. **Scoring**
   - Overall score: 0-100.
   - Narrative score: 0-100.
   - Market-validation score: 0-100.
   - Financial score: 0-100.
   - Confidence score: 0-100.

4. **Gap analysis**
   - Section.
   - Status.
   - Issue.
   - Severity: `low | medium | high | critical`.
   - Recommendation.
   - Evidence citations.

5. **Investor personas**
   - Persona name and investment lens.
   - Why this persona would care.
   - Likely objections.
   - Questions grounded in the deck's weaknesses and the selected round.

6. **Persistence**
   - Validate provider output against Zod.
   - Retry one repair pass for schema-invalid output.
   - Persist the whole successful analysis in one transaction.
   - Mark failure with a safe error code/message; keep detailed provider errors in server logs only.

### 12.3 Analysis behavior

- Never overwrite an existing completed analysis.
- A rerun creates a new analysis with its model and rubric versions.
- Only one active analysis for the same user/document version should be queued at a time; use an idempotency key or application guard.
- Cancellation is best-effort and must result in a terminal status.
- A failed analysis can be retried from the UI.

## 13. Unified AI Frontend

The AI page is new. Reuse the application's layout, colors, UI primitives, authentication, workspace hooks, and API client conventions, but do not copy the current AI placeholder design.

### 13.1 Route and navigation

- Add one protected workspace route: `/ai`.
- Add one sidebar item: `AI Copilot`.
- Remove the two proposed `/ai/chat` and `/ai/analysis` items.
- Redirect `/ai/chat`, `/ai/analysis`, and `/ai-insights` to `/ai` for old bookmarks.
- Keep human `Chat` unchanged at `/chat`.

### 13.2 Desktop layout

```text
+----------------+--------------------------------+----------------------+
| Sessions       | Conversation                   | Context / Artifact   |
|                |                                |                      |
| New chat       | Messages                       | Selected round       |
| Search/history | Tool progress                  | Selected documents   |
| Saved reports  | Analysis cards                 | Sources              |
|                | Composer                       | Analysis details     |
+----------------+--------------------------------+----------------------+
```

- Left column: collapsible session history and new-chat action.
- Center: conversation, streaming states, artifacts, citations, and composer.
- Right: context selection, source list, and the currently opened artifact.
- On smaller screens, session history and context become drawers/sheets; conversation remains primary.

### 13.3 Initial empty state

Show a clear explanation and context-aware starters, for example:

- Analyze a pitch deck.
- Ask about a document.
- Review the active round.
- Find deals needing attention.
- Prepare for an investor meeting.

Disable document starters when there are no ready documents and explain what the user must upload or wait for.

### 13.4 Composer

Required:

- Multiline text input.
- Send and stop-generation controls.
- Selected-context chips.
- Document picker.
- Round picker.
- Optional investor picker when Release 3 ships.
- Keyboard behavior: Enter sends; Shift+Enter creates a new line.
- Prevent duplicate submits while establishing a stream.
- Preserve an unsent draft locally per session.

File uploads should continue through the Documents module. Do not create a second upload system inside AI in v1; provide a link or dialog that uses the existing document upload flow.

### 13.5 Message rendering

Support:

- User and assistant messages.
- Safe Markdown rendering with raw HTML disabled.
- Streaming cursor/state.
- Source citations.
- Tool activity summarized in user language.
- Retry on failed assistant messages.
- Copy response.
- Analysis artifact cards.
- Clear “not enough evidence” states.

Do not display raw chain-of-thought, hidden prompts, provider payloads, or complete tool arguments.

### 13.6 Analysis artifact

Render:

- Status and analyzed document version.
- Four scores plus confidence.
- Executive summary.
- Strengths.
- Prioritized gaps.
- Recommendations.
- Evidence/source links.
- Investor personas and rehearsal action.
- Model/rubric timestamp information in secondary details, not as primary UI noise.

Opening an artifact must not navigate away from the conversation. Use the right panel or a full-screen mobile sheet.

### 13.7 Suggested frontend files

```text
packages/web/src/
  pages/dashboard/Ai/Ai.tsx
  pages/dashboard/Ai/AiSessionList.tsx
  pages/dashboard/Ai/AiConversation.tsx
  pages/dashboard/Ai/AiComposer.tsx
  pages/dashboard/Ai/AiContextPanel.tsx
  pages/dashboard/Ai/AiMessage.tsx
  pages/dashboard/Ai/AiCitations.tsx
  pages/dashboard/Ai/AiAnalysisArtifact.tsx
  pages/dashboard/Ai/artifacts/AiArtifactRenderer.tsx
  pages/dashboard/Ai/artifacts/artifact-registry.ts
  pages/dashboard/Ai/artifacts/AnalysisScorecard.tsx
  pages/dashboard/Ai/artifacts/GapAnalysis.tsx
  pages/dashboard/Ai/artifacts/RoundHealth.tsx
  pages/dashboard/Ai/artifacts/PipelineFocus.tsx
  pages/dashboard/Ai/artifacts/InvestorBrief.tsx
  pages/dashboard/Ai/artifacts/EmailDraft.tsx
  pages/dashboard/Ai/artifacts/PersonaRehearsal.tsx
  pages/dashboard/Ai/AiEmptyState.tsx
  hooks/useAiStream.ts
  lib/ai-api.ts
```

Add AI query keys to the established query-key module and generated types to `api-types.ts` through the OpenAPI generation command. Do not hand-edit generated API types.

### 13.8 Predefined generative UI registry

Build a typed artifact registry. The assistant chooses the most appropriate registered artifact for the result; React owns the actual layout and styling.

Initial registry:

| Artifact type | When it is used | Primary UI |
|---|---|---|
| `analysis_scorecard.v1` | Completed deck analysis | Score ring/bars, confidence, executive summary, strengths |
| `gap_analysis.v1` | Prioritized deck weaknesses | Severity-grouped cards, evidence, recommendations |
| `source_answer.v1` | Document-grounded answer | Answer with expandable source list and excerpts |
| `round_health.v1` | Round status question | Target progress, hard/soft/wired breakdown, gap, time-to-close, risks |
| `pipeline_focus.v1` | “What needs attention?” | Ranked deal cards with reason, owner, quiet days, task due date |
| `investor_brief.v1` | Meeting preparation | Contact context, timeline, current stage, open tasks, likely questions |
| `email_draft.v1` | Follow-up draft | Subject/body preview, context used, copy/edit controls; no send in v1 |
| `persona_rehearsal.v1` | Pitch simulation | Persona card, investment lens, active question, rehearsal controls |
| `comparison.v1` | Compare versions or records | Typed side-by-side fields and highlighted differences |
| `action_suggestions.v1` | Recommended next steps | Read-only suggestion list; no executable actions in Releases 1-3 |

Registry entry requirements:

```ts
type ArtifactDefinition<T> = {
  type: string;
  version: number;
  schema: ZodSchema<T>;
  component: React.ComponentType<{ artifact: T }>;
  requiredCapabilities: string[];
  fallback: "markdown" | "unsupported";
};
```

The exact shared type can differ, but these guarantees are required:

1. The server sends the model only artifact types allowed by the caller's permissions, enabled tools, selected context, and release feature flags.
2. The model returns an artifact intent and schema-valid content, never markup or executable code.
3. For deterministic values such as round metrics, the backend constructs or verifies the artifact payload from trusted tool output. The model may explain the values but may not replace them.
4. The backend validates the artifact payload before storing or streaming `artifact.ready`.
5. The frontend validates the payload again before rendering.
6. Unknown type/version combinations render a safe fallback message and ordinary text; they never crash the conversation.
7. Artifact actions are registered callbacks identified by allowlisted action IDs. The model cannot provide an arbitrary URL, HTTP method, API path, or JavaScript handler.
8. Every record link is constructed by the frontend from a validated entity type and ID through existing route helpers.
9. Components use the application's design tokens and shared UI primitives. Artifact JSON contains semantic values, not Tailwind classes, colors, pixel dimensions, or layout instructions.
10. All components include loading, empty, partial-data, error, keyboard, screen-reader, dark-theme, and mobile states.

### 13.9 Capability-aware agent instructions

Build the agent's available capability manifest on the server for every run. It should contain only:

- Authorized read-only tools.
- Registered artifact types supported by the current frontend release.
- Selected round/document/investor context.
- Whether analysis or persona rehearsal is available.
- Safe action IDs available in the current release.

The system instruction should tell the model when each artifact is appropriate. It must also permit a normal text response when no artifact improves the answer. Do not force every message into a card.

Example behavior:

- A short factual answer uses text plus citations.
- “How is the round doing?” uses `round_health.v1` plus a concise explanation.
- “What should I do today?” uses `pipeline_focus.v1`.
- “Analyze my deck” starts analysis and later renders `analysis_scorecard.v1` and `gap_analysis.v1`.
- “Draft a follow-up” renders `email_draft.v1`; it does not expose a send control until confirmed actions are implemented.

The UI registry is a product API. Version payload schemas instead of making incompatible edits to an existing type.

### 13.10 Visual quality bar

All artifacts should feel like one coherent product rather than unrelated generated cards.

- Create a shared `ArtifactShell` for title, provenance, timestamp, loading/error state, secondary actions, and source disclosure.
- Use progressive rendering: stream the text explanation while a structured artifact is building, then transition the validated artifact into place without replacing or jumping the entire message.
- Use skeletons with stable dimensions to prevent layout shift.
- Use typography, spacing, radii, borders, shadows, and semantic colors from existing design tokens only.
- Reserve charts and visualizations for relationships they clarify: score breakdowns, round progress, funnel conversion, engagement drop-off, and comparisons.
- Never use color as the only severity or status signal; pair it with labels and icons.
- Keep dense data scannable with a summary first and expandable evidence/details.
- Use restrained motion for artifact arrival, expansion, and stream completion; respect `prefers-reduced-motion`.
- Keep primary actions stable and predictable. Generated content must not move destructive or future write actions into prominent positions.
- On mobile, render one readable column and move evidence/context into accessible sheets rather than shrinking desktop cards.
- Provide realistic fixture payloads for every artifact so design review can inspect complete, partial, empty, long-text, error, dark-theme, and mobile states without calling a model.

Acceptance for a new artifact component includes schema validation, all states above, keyboard navigation, screen-reader labels, responsive behavior, and review using fixture data.

## 14. Security, Privacy, and Reliability

### 14.1 Tenant isolation

- Every route validates `startupId` and calls `requireMember`.
- Every session/analysis/document lookup includes the startup scope.
- Vector search joins to `Document.startupId` inside the query.
- Never retrieve broadly and filter tenant results in application memory.
- Add explicit cross-startup tests for sessions, messages, analyses, document versions, citations, and every tool.

### 14.2 Prompt injection and untrusted content

Documents, notes, comments, chat content, and interaction logs are untrusted data.

- Mark retrieved content as data, never as instructions.
- Do not let document text select tools or override system policies.
- Tool definitions and authorization are server-owned.
- Bound tool-call rounds and result sizes.
- Reject unknown tool names and invalid arguments.
- Reject unknown artifact types, versions, action IDs, entity types, and record-link shapes.
- Never render model-generated HTML, JSX, CSS, SVG, script, iframe content, or arbitrary URLs.
- Sanitize rendered Markdown and links.

### 14.3 Sensitive data

- Do not send authentication tokens, Google tokens, password hashes, IP hashes, device hashes, or storage credentials to the model.
- Return only fields required for the current tool.
- Redact provider errors before returning them to users.
- Do not log complete prompts or document text by default.
- Establish a retention/deletion policy before production launch.
- Deleting a startup or user must cascade or remove associated AI data consistently.

### 14.4 Rate limits and quotas

Add AI-specific limits separate from the global API limiter:

- Messages per user/minute.
- Concurrent streams per user.
- Analyses per startup/day according to plan.
- Maximum queued analyses per startup.
- Input and output token caps.
- Maximum pinned documents and retrieved chunks.

Return stable error codes that the frontend can explain.

### 14.5 Reliability

- Provider timeouts and abort signals.
- Limited retries only for transient failures.
- No automatic retry after meaningful streamed output unless idempotency is guaranteed.
- Terminal database state for completed, failed, or cancelled work.
- BullMQ retry/backoff for analysis jobs.
- Graceful behavior when embeddings are missing.
- Feature flag to disable AI without disabling the rest of the application.

## 15. Testing and Evaluation

### 15.1 Backend unit tests

Add tests for:

- Session ownership and startup scoping.
- Session/document/version validation.
- Message role and input validation.
- Retrieval SQL filters and citation mapping.
- Permission intersection for every tool.
- Provider adapter success, timeout, cancellation, malformed output, and rate-limit failures.
- Analysis state transitions and transactional persistence.
- Idempotent analysis submission.
- Token/context budgeting.
- Prompt-injection-shaped document text.

Provider calls must be stubbed. Unit and CI tests must never call a paid model.

### 15.2 API integration tests

Cover:

- Full session/message lifecycle.
- SSE event ordering and terminal event.
- SSE reconnect with `Last-Event-ID`, replay without duplicate generation, heartbeat behavior, and expired-buffer snapshot recovery.
- Two clients attached to the same message without starting two provider calls.
- Reconnect/reload after a completed response.
- Cancellation.
- Analysis queue -> completed/failed transitions using a fake worker/provider.
- Cross-tenant access attempts.
- Viewer/collaborator/owner permission differences.
- OpenAPI contract agreement.

### 15.3 Frontend tests

Cover:

- Empty state with and without ready documents.
- Creating and reopening a session.
- Rendering streaming deltas.
- Rendering every registered artifact type with valid, partial, invalid, and unknown-version payloads.
- Safe fallback when artifact validation fails.
- Confirming the UI never interprets artifact data as HTML, CSS, component names, routes, or actions.
- Stop and retry behavior.
- Context selection.
- Citation rendering and navigation.
- Analysis queued, processing, completed, and failed views.
- Responsive drawer behavior.
- Keyboard and accessibility behavior.

### 15.4 AI evaluation set

Create version-controlled, non-sensitive fixture documents and expected checks. At minimum include:

- A complete pitch deck.
- A deck missing financial information.
- A deck with conflicting numbers.
- A document containing prompt-injection-like text.
- Questions with direct answers.
- Questions with no answer in the selected documents.
- Exact-name and exact-number questions.
- Pipeline/round scenarios with deterministic expected tool output.

Measure:

- Citation validity: cited chunks actually support the claim.
- Citation coverage: important grounded claims have citations.
- Refusal/uncertainty quality when evidence is missing.
- Structured-output schema success rate.
- Tool-selection accuracy.
- Numerical faithfulness to tool output.
- Latency to first token and full completion.
- Tokens and estimated cost per operation.

Run the evaluation manually during early development, then add a non-blocking repeatable command. Promote it to a release gate after thresholds are agreed.

## 16. Observability and Product Metrics

Record operational metadata without storing unnecessary prompt content:

- Provider and model.
- Operation type.
- Success/failure/cancellation.
- Input/output tokens.
- Retrieval count and score range.
- Tool names and durations.
- Time to first token.
- Total latency.
- Analysis queue and processing duration.
- Stable error code.

Track product behavior:

- Users starting a session.
- Sessions reaching a completed response.
- Citation opens.
- Analyses requested/completed/retried.
- Follow-up questions after an analysis.
- Persona rehearsals started.
- Drafts copied.

Do not treat message count alone as success. Useful follow-ups, citation use, analysis completion, and low retry/failure rates are stronger signals.

## 17. Build Order and Ticket Breakdown

Sizes are relative: XS, S, M, L.

### Foundation

1. **AI product contract and rubric — S**
   - Confirm decisions in section 20.
   - Write the first deck-analysis Zod schema and scoring rubric.
   - Create evaluation fixtures before prompt implementation.
   - Acceptance: schema, rubric, example valid result, and expected evaluation checks are reviewed.

2. **AI schema migration — M**
   - Implement section 8.
   - Update seed cleanup and optional demo AI records.
   - Acceptance: migration applies cleanly; Prisma generates; cascading and cross-startup constraints are tested.

3. **Provider adapter and configuration — M**
   - Add config validation, streaming, structured output, embedding query, timeouts, usage extraction, and fake provider for tests.
   - Acceptance: no business service imports the provider SDK directly; adapter tests cover failures and cancellation.

4. **AI route skeleton and OpenAPI — S**
   - Validators, controller, routes, permissions, error codes, and empty session CRUD.
   - Acceptance: owner can CRUD own session; other user/startup cannot access it; OpenAPI and generated types agree.

### Release 1: document chat

5. **Tenant-safe document retrieval — L**
   - Query embeddings, vector SQL, deduplication, token budgeting, citations, and vector index.
   - Acceptance: retrieval never crosses startup/version scope and passes the direct-answer/no-answer evaluation cases.

6. **Streaming chat service — L**
   - History budgeting, retrieval, provider stream, persistence, SSE mapping, stop/cancel, error recovery, usage.
   - Acceptance: completed, disconnected, cancelled, malformed, and provider-failure paths all reach a valid terminal state.

7. **Unified AI page shell — M**
   - `/ai` route, one nav item, redirects, responsive three-panel shell, empty state, session list, context selectors, and artifact-renderer foundation.
   - Acceptance: works on desktop/mobile and does not depend on the old AI placeholder.

8. **Conversation UI — L**
   - Composer, reconnectable SSE client, streaming messages, stop/retry, citations, errors, reload/resume, local draft, and Redis replay integration.
   - Acceptance: full document question flow works end to end; reconnect does not duplicate generation; accessible keyboard behavior works.

9. **Typed artifact registry — M**
   - Shared schemas, server capability manifest, persisted artifacts, renderer registry, safe fallbacks, initial source-answer and comparison artifacts.
   - Acceptance: the agent can select only allowed registered artifacts; invalid/unknown artifacts fail safely; no model-generated markup or arbitrary action can render.

### Release 2: analysis

10. **Analysis service and worker — L**
   - Queueing, rubric pipeline, Zod validation/repair, persistence, cancellation, retry, usage.
   - Acceptance: fixture decks produce schema-valid analyses; missing evidence is represented honestly; reruns preserve history.

11. **Analysis artifact UI — M**
    - Progress, scores, gaps, recommendations, confidence, evidence, failure/retry, artifact panel.
    - Acceptance: user can open sources and ask a follow-up without leaving the conversation.

12. **Investor persona rehearsal — M**
    - Persona persistence, persona selection, persona-specific conversation instruction, clear simulation labeling.
    - Acceptance: persona questions reference actual deck/round context and the assistant never pretends to be a real investor.

### Release 3: fundraising data

13. **Read-only structured tools — L**
    - Implement the tools in section 11 using existing services.
    - Acceptance: tool output matches direct service output and permission-intersection tests pass.

14. **Record-aware UI and deep links — M**
    - Context chips for round/investor, record citations, links to pipeline/investor/fundraising/documents.
    - Acceptance: structured answers identify their source records and users can navigate to them.

15. **Meeting brief and draft templates — M**
    - Structured meeting brief and follow-up draft artifacts; copy only, no sending.
    - Acceptance: drafts use selected investor context, label missing context, and never invent prior interactions.

### Hardening and release

16. **Quotas, telemetry, privacy controls — M**
17. **Evaluation run and prompt/rubric tuning — M**
18. **Security review and cross-tenant test audit — M**
19. **Feature-flagged beta and operational runbook — S**

## 18. Suggested Parallel Work

After tickets 1-4 establish contracts:

- Backend lane: retrieval -> streaming chat -> structured tools.
- Analysis lane: rubric/evaluation -> analysis worker -> persona rehearsal.
- Frontend lane: page shell -> conversation UI -> analysis artifacts.
- Quality lane: cross-tenant tests, evaluation harness, telemetry, and runbook alongside each feature.

Do not build the conversation UI against invented response shapes. Freeze the OpenAPI streaming event contract and analysis schema first.

## 19. Definition of Done

The unified AI module is complete for Releases 1-3 when:

1. `/ai` is the only AI navigation destination.
2. Human team chat remains independent.
3. AI sessions are private, persistent, resumable, and startup-scoped.
4. Document answers use selected versions and provide valid citations.
5. Missing evidence is stated instead of hallucinated.
6. Deck analysis is asynchronous, version-pinned, structured, reproducible, and never overwrites history.
7. Analysis recommendations link to evidence when evidence exists.
8. Investor personas are clearly simulations.
9. Fundraising questions use deterministic application services through bounded tools.
10. Tool availability respects both AI permission and underlying resource permission.
11. No AI endpoint or vector query can cross tenant boundaries.
12. Model calls are rate-limited, observable, cancellable, and covered by stable error handling.
13. Unit/integration/frontend tests pass without live paid model calls.
14. The evaluation set meets agreed groundedness and schema-validity thresholds.
15. `openapi.yaml` and generated frontend types ship with API changes.
16. AI can be disabled with a feature flag without affecting the rest of the product.
17. No write action occurs without explicit confirmation; Releases 1-3 contain no AI writes to business records.
18. SSE reconnects and replays without starting duplicate provider generations.
19. The assistant can render only registered, schema-validated artifact types supported by the current frontend.
20. No model response can inject markup, styling, arbitrary navigation, or executable actions into the UI.

## 20. Decisions to Confirm Before Implementation

Resolve these during ticket 1. Recommended choices are included.

1. **Session visibility**  
   Recommend private per user for v1, with separately shareable reports later.

2. **Default context**  
   Recommend selected active round plus explicitly selected documents. “Workspace” allows tools but does not automatically include every document.

3. **AI permission model**  
   Recommend keeping `ai_reports:read/create` and intersecting it with each underlying resource permission.

4. **Analysis quota**  
   Pricing currently mentions limited analysis on one tier and unlimited on another, but billing enforcement is not represented in the inspected AI code. Decide whether quotas are feature-flag configuration or require a subscription/usage model first.

5. **Analysis scoring rubric**  
   Product must approve definitions and weights. Engineering should not invent a scoring rubric invisibly inside a prompt.

6. **Provider/model choices**  
   Select using the evaluation set for quality, latency, structured-output reliability, and cost. Keep choices configurable.

7. **Retention**  
   Decide how long private conversations, prompts, excerpts, and provider metadata are retained and what account/startup deletion must erase.

8. **Reviewer-data access**  
   Decide which existing permission protects reviewer engagement before exposing that tool.

9. **Voice meaning**  
   If “speak with AI” means normal text conversation, voice is out of scope. If literal audio is required, plan it as a later input/output layer after chat quality is stable.

10. **Citation precision**  
    Accept document/version/section citations for v1. Plan page-aware parsing separately rather than displaying unreliable page numbers.

## 21. Expected Files to Touch

Backend:

- `packages/api/prisma/schema.prisma`
- `packages/api/prisma/migrations/`
- `packages/api/prisma/seed.ts`
- `packages/api/src/config/ai.ts`
- `packages/api/src/config/env.ts`
- `packages/api/src/config/permissions.ts`
- `packages/api/src/validators/ai.schemas.ts`
- `packages/api/src/routes/ai.routes.ts`
- `packages/api/src/routes/startup.routes.ts`
- `packages/api/src/controllers/ai.controller.ts`
- `packages/api/src/services/ai-*.service.ts`
- `packages/api/src/jobs/queue.ts`
- `packages/api/src/jobs/workers/ai-analysis.worker.ts`
- `packages/api/src/jobs/workers/index.ts`
- `packages/api/openapi.yaml`
- `packages/api/.env.example`
- `packages/api/tests/unit/ai-*.test.ts`

Frontend:

- `packages/web/src/routes/index.tsx`
- `packages/web/src/components/layout/Sidebar.tsx`
- `packages/web/src/pages/dashboard/Ai/`
- `packages/web/src/hooks/useAiStream.ts`
- `packages/web/src/lib/ai-api.ts`
- `packages/web/src/lib/query-keys.ts`
- `packages/web/src/lib/api-types.ts` generated from OpenAPI
- `packages/web/src/test/pages/ai.test.tsx`
- `packages/web/src/test/hooks/use-ai-stream.test.tsx`

Documentation/operations:

- Root/project README environment notes.
- AI privacy and retention documentation.
- Model evaluation fixtures and run command.
- Operational runbook for provider outages, stuck jobs, quotas, and feature-flag shutdown.

## 22. First Action

Do not begin by building the page.

The first implementation task is ticket 1: agree on the analysis output schema, scoring rubric, session privacy, default context, and evaluation fixtures. Then complete the schema/API contracts. The frontend, retrieval service, and analysis worker can proceed in parallel only after those contracts are stable.
