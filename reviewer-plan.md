# Reviewer Workspace - Product and Engineering Plan

This document is the implementation brief for the reviewer feature. It covers both sides of the experience:

1. The founder-facing **Reviewers** page used to invite people, choose documents, monitor engagement, and handle feedback.
2. The external **Reviewer Portal** used by an investor, advisor, lawyer, or other reviewer without requiring a normal product account.

The goal is not merely to create a shared link. The feature should be a secure, version-aware review workflow with clear feedback, reliable access control, and useful founder-side visibility.

## 1. Current repository reality

Do not assume the feature already exists because it appears in the schema or OpenAPI file.

- The sidebar links to `/reviewers`, but there is no matching React route or page.
- `Documents.tsx` still displays static values and is not connected to a document API.
- Prisma contains early reviewer tables, but they are not sufficient for a high-quality threaded, version-aware review experience.
- `openapi.yaml` describes document and reviewer endpoints, but there are no corresponding routes, controllers, services, or validators under `packages/api/src`.
- The OpenAPI reviewer management paths are not startup-scoped. Owner-side endpoints should follow the repository's real multi-tenant convention: `/api/v1/startups/:startupId/...`.

Treat the current schema and OpenAPI definitions as a draft, not as the final implementation contract.

## 2. Product principles

- A reviewer should not need to create a full account.
- Access must be limited to explicitly shared immutable document versions.
- The raw invitation token must never be stored in the database.
- The file's permanent storage URL must never be sent to the browser.
- Founders must be able to revoke access immediately.
- Review feedback must remain attached to the exact version and page that was reviewed.
- The portal should be calm and focused: open document, understand context, comment, and finish.
- Engagement signals should be useful without becoming invasive surveillance.
- Security and authorization must be enforced in the API, never only hidden in the UI.

## 3. Recommended user experience

### 3.1 Founder-facing Reviewers page

Route: `/reviewers`, inside the authenticated application layout and `RequireWorkspace`.

The page should contain:

- A header with **Invite reviewer** as the primary action.
- Summary metrics: awaiting access, in review, completed, and expiring soon.
- Search by reviewer name, email, investor, or document.
- Filters for status, document, creator, and expiration.
- A table on desktop and cards on mobile.
- Each row should show reviewer, shared documents, status, last activity, comment count, and expiry.
- Row actions: open details, copy access link, resend email, change expiry, revoke access, and delete after revocation.

Invitation statuses should be understandable product states:

- `pending`: invitation created but not opened.
- `opened`: link opened or verification requested.
- `in_review`: reviewer has viewed at least one document.
- `completed`: reviewer explicitly submitted the review.
- `revoked`: founder removed access.
- `expired` should normally be derived from `expiresAt < now`, rather than maintained by an unreliable background status update.

The reviewer detail sheet should contain three tabs:

- **Overview**: identity, access scope, expiry, linked investor, and controls.
- **Feedback**: comment threads grouped by document and page, with unresolved first.
- **Activity**: invitation sent, access verified, document opened, comment added, review completed, access revoked.

### 3.2 Invite reviewer flow

Use a focused multi-step dialog:

1. Reviewer: name, email, and optional linked CRM investor.
2. Documents: choose one or more documents and explicitly choose the current immutable version of each.
3. Access: expiry, allow download, optional message, and optional reminder.
4. Review: show exactly what will be shared before sending.

Defaults:

- Expiry: 14 days.
- Download: off for sensitive fundraising documents.
- Version: the current version at invitation time, pinned thereafter.
- Reminder: one reminder 48 hours before expiry if the review is incomplete.

If a founder uploads a new document version later, do not silently replace the version visible to an existing reviewer. Offer an explicit **Share new version** action that records the scope change and notifies the reviewer.

### 3.3 External Reviewer Portal

Public routes should not use `AppLayout`, `ProtectedRoute`, the founder auth provider, or startup membership logic.

Recommended frontend routes:

- `/review/:token`: validate invitation and request an email code.
- `/review/:token/verify`: enter the six-digit code.
- `/review/workspace`: authenticated reviewer workspace backed by the reviewer-session cookie.
- `/review/expired`: clear expired or revoked state without leaking private details.

Portal layout:

- Minimal startup branding and reviewer identity.
- Document/version list on the left.
- PDF viewer in the center.
- Feedback panel on the right, collapsible on smaller screens.
- Progress indicator showing documents viewed and unresolved draft comments.
- Persistent **Finish review** action.
- Mobile experience should prioritize document navigation and page-level comments rather than copying the desktop three-column layout.

Reviewer actions:

- View only the pinned versions in the invitation scope.
- Add a general review note.
- Start a comment thread on a page or selected region.
- Edit or delete their own message during the active session.
- Reply to a founder response.
- Mark a thread resolved or reopen it.
- Mark the review complete and optionally leave a final summary.
- Download only when the invitation explicitly allows it.

## 4. Recommended database model

The existing reviewer models should be migrated to a version-aware, thread-based model before building the UI. New columns and tables are expected.

### `ReviewInvitation`

- `id` UUID primary key.
- `startupId` tenant key.
- `startupInvestorId` nullable link to the startup-scoped CRM investor.
- `reviewerName` nullable.
- `emailNormalized` lowercase normalized email.
- `tokenHash` unique SHA-256 hash of the raw invitation token.
- `status` enum: `pending`, `opened`, `in_review`, `completed`, `revoked`.
- `allowDownload` boolean, default false.
- `personalMessage` nullable text with a conservative length limit.
- `expiresAt` timestamp.
- `completedAt`, `revokedAt`, and `lastActivityAt` nullable timestamps.
- `createdBy` user ID.
- `createdAt` and `updatedAt`.
- Indexes on `(startupId, status)`, `(startupId, emailNormalized)`, and `(startupId, expiresAt)`.

Do not store the raw invitation token. Generate at least 32 random bytes with Node's `crypto.randomBytes`, encode with base64url, email the raw value once, and store only `sha256(rawToken)`.

### `ReviewInvitationDocument`

- `id` UUID primary key.
- `invitationId`.
- `documentId`.
- `documentVersionId` - required and immutable for that share record.
- `displayOrder` integer.
- `addedAt` and `addedBy`.
- Unique `(invitationId, documentVersionId)`.

Both `documentId` and `documentVersionId` should be verified as belonging to the same startup as the invitation inside one transaction. Pinning a version prevents comments from becoming detached when a new file is uploaded.

### `ReviewSession`

- `id` UUID primary key.
- `invitationId`.
- `sessionTokenHash` unique hash of an opaque random session token.
- `verifiedAt`, `lastSeenAt`, and `expiresAt`.
- `revokedAt` nullable.
- `ipAddressHash` nullable; prefer a keyed hash if retained.
- `userAgent` nullable with a bounded length.
- `createdAt`.
- Index `(invitationId, expiresAt)`.

Use an opaque random session token, store only its hash, and check the session plus invitation on every portal request. This makes revocation immediate. A self-contained JWT is less suitable because it remains valid unless every request still performs a database check.

### `ReviewVerificationChallenge`

Keep OTP challenges separate from authenticated sessions.

- `id` UUID primary key.
- `invitationId`.
- `codeHash` using HMAC-SHA-256 with `OTP_HMAC_SECRET`.
- `expiresAt` with a 10-minute maximum.
- `attemptCount` and `maxAttempts`, default 5.
- `consumedAt` nullable.
- `createdAt`.

Only the latest unconsumed challenge should be accepted. Consume it atomically when verification succeeds. Never log the code.

### `ReviewThread`

- `id` UUID primary key.
- `startupId`.
- `invitationId`.
- `documentId` nullable for a general review thread.
- `documentVersionId` nullable for a general review thread.
- `pageNumber` nullable.
- `anchor` nullable JSON containing normalized page coordinates, selected text excerpt, and viewer schema version.
- `status` enum: `open`, `resolved`.
- `createdByType` enum: `reviewer`, `member`.
- `createdByReviewerSessionId` or `createdByMemberId`, enforced by service validation.
- `resolvedAt` and resolver identity fields.
- `createdAt` and `updatedAt`.
- Indexes on `(invitationId, status)` and `(documentVersionId, pageNumber)`.

Store normalized coordinates from 0 to 1, not screen pixels, so annotations survive zooming and different screen sizes. Treat selected text as display context only, not as authorization or the canonical anchor.

### `ReviewMessage`

- `id` UUID primary key.
- `threadId`.
- `authorType` enum: `reviewer`, `member`.
- Reviewer session ID or startup member ID.
- `body` plain text.
- `editedAt` and `deletedAt` nullable.
- `createdAt`.

Use soft deletion for messages that have replies so the conversation structure is retained. Render user text as plain text; do not support raw HTML in the first release.

### `ReviewEvent`

- `id` UUID primary key.
- `startupId`.
- `invitationId`.
- `reviewerSessionId` nullable.
- `eventType` enum.
- `documentVersionId` nullable.
- `metadata` JSON with a strict service-owned shape.
- `createdAt`.
- Index `(invitationId, createdAt)`.

Useful events: `invitation_created`, `invitation_sent`, `access_requested`, `access_verified`, `document_viewed`, `document_downloaded`, `thread_created`, `review_completed`, `scope_changed`, and `access_revoked`.

Do not record mouse movement, reading time guesses, or other invasive analytics. Deduplicate repeated document-view events within a short time window.

## 5. API design

Update `packages/api/openapi.yaml` first or in the same change as each endpoint. Regenerate frontend types after the contract is stable.

### Founder-side, authenticated and startup-scoped

- `GET /api/v1/startups/:startupId/reviewer-invitations`
- `POST /api/v1/startups/:startupId/reviewer-invitations`
- `GET /api/v1/startups/:startupId/reviewer-invitations/:invitationId`
- `PATCH /api/v1/startups/:startupId/reviewer-invitations/:invitationId`
- `POST /api/v1/startups/:startupId/reviewer-invitations/:invitationId/resend`
- `POST /api/v1/startups/:startupId/reviewer-invitations/:invitationId/revoke`
- `POST /api/v1/startups/:startupId/reviewer-invitations/:invitationId/share-version`
- `GET /api/v1/startups/:startupId/reviewer-invitations/:invitationId/threads`
- `POST /api/v1/startups/:startupId/review-threads/:threadId/messages`
- `PATCH /api/v1/startups/:startupId/review-threads/:threadId`
- `GET /api/v1/startups/:startupId/reviewer-invitations/:invitationId/events`

Use `requireMember` and `requirePermission("documents", "share")` for invitation mutations. Reading reviewer feedback should require `documents:read`. Every service query must scope by `startupId`; never fetch by invitation ID alone and check later.

Prefer explicit revoke and resend endpoints over hiding important domain actions inside a generic PATCH.

### Reviewer portal, public identity but session-protected data

- `POST /api/v1/reviewer-portal/access` - validate token and send OTP.
- `POST /api/v1/reviewer-portal/verify` - verify OTP and establish session.
- `POST /api/v1/reviewer-portal/logout` - revoke current session and clear cookie.
- `GET /api/v1/reviewer-portal/me` - invitation, startup display data, and allowed versions.
- `GET /api/v1/reviewer-portal/documents/:documentVersionId`
- `POST /api/v1/reviewer-portal/documents/:documentVersionId/file-access` - return a short-lived signed view/download URL.
- `GET /api/v1/reviewer-portal/threads`
- `POST /api/v1/reviewer-portal/threads`
- `POST /api/v1/reviewer-portal/threads/:threadId/messages`
- `PATCH /api/v1/reviewer-portal/messages/:messageId`
- `DELETE /api/v1/reviewer-portal/messages/:messageId`
- `PATCH /api/v1/reviewer-portal/threads/:threadId`
- `POST /api/v1/reviewer-portal/complete`

Portal authorization must prove all of the following for every request:

1. The session token hash matches an unexpired, unrevoked session.
2. The invitation is not revoked, completed-with-access-disabled, or expired.
3. The requested document version exists in `ReviewInvitationDocument` for that invitation.
4. The requested thread or message belongs to the same invitation.
5. The actor is allowed to modify that message or thread.

Return the same generic response for unknown, expired, and revoked raw tokens where practical. This reduces invitation enumeration.

## 6. File storage and document viewer

### Storage

Use private S3-compatible object storage such as AWS S3 or Cloudflare R2. Keep the provider behind a small `storage.service.ts` interface so the application is not coupled to one vendor.

Recommended flow:

1. Founder requests an upload URL from the authenticated API.
2. API validates MIME type, size, filename, and permission, then returns a short-lived presigned upload URL.
3. Browser uploads directly to private object storage.
4. Browser confirms the upload to the API.
5. API creates the immutable `DocumentVersion` after verifying object metadata.
6. Reviewer requests a short-lived signed read URL only after portal authorization succeeds.

Store an object key, not a public URL, in `DocumentVersion`. Add `mimeType`, `originalFilename`, `checksumSha256`, `storageProvider`, `storageKey`, and processing status fields. Signed read URLs should normally live for 5 minutes or less. Use `Content-Disposition: inline` for viewing and only allow attachment downloads when `allowDownload` is true.

Start with PDF only for the review experience. Supporting Office documents safely requires conversion and substantially more processing. Validate both extension and detected content type; do not trust browser-provided MIME data.

### PDF viewer

Use `react-pdf` backed by Mozilla PDF.js. Do not build a PDF renderer from scratch. Pin the `pdfjs-dist` version compatible with `react-pdf`, configure its worker through Vite, and test production builds because worker configuration often differs from development.

Build annotations as an overlay above each PDF page using normalized coordinates. Keep zoom and page state in local component state or the URL, not global Zustand. Virtualize or render only nearby pages for large files.

## 7. What to use in this repository

Reuse the established stack:

- **React Router** for founder and public portal route trees.
- **TanStack Query** for invitations, threads, messages, events, and mutations.
- **React Hook Form + Zod** for invite, OTP, comment, and access forms.
- **Radix/shadcn-style components** already under `components/ui` for dialogs, dropdowns, selects, and accessible focus behavior.
- **Tailwind CSS** for responsive layout and visual states.
- **Sonner** for mutation results, while keeping validation errors beside fields.
- **Express + Zod + Prisma** using the repo's route -> middleware -> controller -> service pattern.
- **BullMQ + Resend** for invitation, OTP, reminder, completion, and founder-notification emails.
- **Redis-backed rate limiting** for access, OTP verification, resend, comment creation, and signed URL generation.
- **Node `crypto`** for invitation/session tokens and keyed OTP hashing.
- **Vitest + Testing Library** for frontend behavior.
- **Jest + Supertest** and mocked Prisma for API unit and route tests.
- **react-pdf/PDF.js** as the one intentional frontend dependency for the document viewer.
- An **S3-compatible SDK** as the intentional backend dependency for private object storage and presigned URLs.

Do not add Redux, a second form library, a second query cache, a custom cryptography package, or WebSockets for the first release. Founder-side feedback can refetch after mutations and optionally poll while the detail sheet is open. Realtime transport can be added later if actual usage justifies it.

## 8. Security requirements

- Generate all invitation and session tokens with a cryptographically secure random source.
- Store hashes only; never log raw tokens, OTP codes, session cookies, or signed file URLs.
- Use a separate cookie name from founder auth, for example `reviewerSessionToken`.
- Cookie flags: `HttpOnly`, `Secure` in production, `SameSite=Lax`, narrow `Path=/api/v1/reviewer-portal`, and an explicit maximum age.
- Validate the `Origin` header for state-changing portal requests as defense in depth against CSRF.
- Rotate the reviewer session after successful OTP verification.
- Revoke all invitation sessions when the founder revokes the invitation or changes its email.
- Rate-limit by both IP and normalized invitation/email identity where possible.
- Apply resend cooldowns and hard OTP attempt limits.
- Use database transactions for verification, scope changes, completion, and revocation.
- Prevent IDOR by querying through invitation/startup relationships, not by trusting document, thread, or message IDs from the client.
- Escape all displayed content and store comments as plain text.
- Set a strict Content Security Policy for the public portal and ensure the PDF worker/storage origins are intentional.
- Return `Cache-Control: no-store` for portal API responses and sensitive HTML routes.
- Keep audit events append-only from normal application paths.
- Define retention: revoke access immediately; delete or anonymize IP/user-agent data on schedule; retain review feedback according to startup policy.

## 9. Email and notification behavior

Create dedicated templates instead of reusing account-auth OTP copy:

- Review invitation: startup name, founder name, optional message, document count, expiry, and access button.
- Access code: six-digit code, 10-minute validity, and a warning not to forward it.
- Reminder: only when not completed or revoked.
- New feedback notification to founders: batch nearby comments to avoid spam.
- Review completed notification.
- New document version shared notification.

Queue all email through the existing BullMQ email worker. API success should mean the job was accepted, not that the external email provider completed delivery. Record delivery attempts separately from reviewer engagement.

Link a review invitation to a `StartupInvestor` when possible. Add review events to the investor activity timeline through a domain event/notification integration rather than duplicating timeline records in controller code.

## 10. Implementation phases for the coworker

### Phase A - Contract and schema foundation

- [ ] Confirm the MVP supports PDF files only.
- [ ] Replace or migrate the placeholder reviewer models to the version-aware schema above.
- [ ] Add document storage metadata fields and immutable version rules.
- [ ] Create and review a Prisma migration; do not use `db push` as the delivery artifact.
- [ ] Rewrite the reviewer/document sections of `openapi.yaml` with startup-scoped owner routes.
- [ ] Regenerate `packages/web/src/lib/api-types.ts`.
- [ ] Add service-level authorization test cases before UI work.

Deliverable: reviewed schema, migration, API contract, and threat-model notes.

### Phase B - Documents and private storage

- [ ] Implement document validators, services, controllers, and routes.
- [ ] Add direct private upload and upload confirmation.
- [ ] Add version listing and current-version management.
- [ ] Add authorized short-lived read URLs.
- [ ] Replace the static Documents page with live API data, upload, version history, and error states.
- [ ] Test cross-startup access and invalid object metadata.

Deliverable: a founder can upload and view an immutable PDF version securely.

### Phase C - Invitations and verification

- [ ] Implement owner-side invitation CRUD, explicit resend, revoke, and scope-change actions.
- [ ] Generate hashed invitation tokens and queue invitation emails.
- [ ] Implement OTP challenge creation, cooldown, attempt limits, and atomic consumption.
- [ ] Implement opaque reviewer sessions and middleware.
- [ ] Add public access, verification, session, and logout endpoints.
- [ ] Add rate-limit and expiry tests.

Deliverable: a reviewer can securely enter the portal and only see pinned document versions.

### Phase D - Founder Reviewers page

- [ ] Add the `/reviewers` route under `RequireWorkspace`.
- [ ] Implement live metrics, table/cards, search, filters, pagination, and states.
- [ ] Implement the invitation dialog with document/version selection.
- [ ] Implement the reviewer detail sheet with Overview, Feedback, and Activity tabs.
- [ ] Gate controls with `documents:share` and feedback with `documents:read`.
- [ ] Add copy-link, resend, expiry, scope-change, revoke, and deletion confirmations.

Deliverable: founders can manage the complete invitation lifecycle.

### Phase E - Review portal and feedback

- [ ] Add a public reviewer route layout separate from founder authentication.
- [ ] Build access and OTP screens with resend countdown and accessible errors.
- [ ] Add the PDF viewer with page navigation, zoom, loading, and failure recovery.
- [ ] Add page/region anchored threads and plain-text messages.
- [ ] Add edit/delete-own-message and resolve/reopen behavior.
- [ ] Add general summary feedback and explicit Finish review.
- [ ] Make the portal responsive and keyboard accessible.

Deliverable: an external reviewer can review, comment, and complete without a product account.

### Phase F - Activity, notifications, and hardening

- [ ] Record bounded, append-only review events.
- [ ] Surface events in the reviewer detail sheet and linked investor activity.
- [ ] Queue founder notifications and expiry reminders without email spam.
- [ ] Add cleanup jobs for expired challenges and sessions.
- [ ] Add end-to-end happy path, revoke-during-session, expiry, and tenant-isolation tests.
- [ ] Add monitoring for OTP failures, email jobs, signed URL failures, and portal render errors.
- [ ] Run security and accessibility reviews before release.

Deliverable: observable, tested, production-ready review workflow.

## 11. Required test matrix

At minimum, automate these cases:

- Founder without `documents:share` cannot invite, resend, change scope, or revoke.
- A startup member cannot read or mutate another startup's invitation by guessed UUID.
- Raw token is returned only at creation/email time and never stored.
- Unknown, revoked, and expired invitations cannot create an authenticated session.
- OTP expires, has a resend cooldown, locks after the maximum failures, and cannot be reused.
- Revocation invalidates every active session immediately.
- Reviewer A cannot request reviewer B's document, thread, message, or signed URL.
- Reviewer cannot access another version of an allowed document unless it was explicitly shared.
- `allowDownload=false` prevents attachment access at the API level.
- Comment anchors render correctly at multiple zoom levels.
- Reviewer can edit/delete only their own messages.
- Founder feedback permissions and tenant scope are enforced.
- Completion is idempotent and does not send duplicate notifications.
- Navigating between founder pages does not require refresh and does not reuse incompatible query-cache data.
- Public portal works with keyboard navigation and screen-reader labels.

## 12. Definition of done

The reviewer feature is complete only when:

- A founder can upload a versioned PDF, invite a reviewer, and revoke that access.
- The reviewer can verify by email, view only the pinned files, leave anchored feedback, and complete the review.
- The founder can read and respond to feedback and see a trustworthy activity history.
- No permanent object URL, raw token, or OTP appears in the database, logs, analytics, or client cache.
- Tenant isolation, invitation scope, expiration, revocation, and message ownership are covered by automated tests.
- `openapi.yaml`, Prisma migrations, API implementation, generated frontend types, and UI behavior agree.
- API and web builds pass, relevant tests pass, and the production PDF worker/storage configuration is verified.

## 13. Important implementation warning

Do not start by drawing the `/reviewers` screen against mock data. The critical path is:

**immutable document storage -> invitation scope -> verification/session security -> portal authorization -> comments -> founder management UI**.

Building in that order avoids an attractive frontend that later has to be rewritten because versions, sessions, or access boundaries were modeled incorrectly.
