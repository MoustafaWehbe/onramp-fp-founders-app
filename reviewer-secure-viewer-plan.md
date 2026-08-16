# Secure Reviewer Viewer & Engagement Analytics — Implementation Plan

Companion to `reviewer-plan.md`. That document covers invitations, sessions, and feedback.
This one replaces its §6 (file storage and document viewer) and amends its §4 stance on analytics.

Goal: DocSend / Foundersuite parity. An investor opens a link and can read the deck but
cannot obtain the file, every page they look at is measured, and anything they capture
carries their identity.

---

## 1. Where we are today

| Piece | File | State |
| --- | --- | --- |
| Invitation lifecycle | `packages/api/src/services/reviewer-invitation.service.ts` | Solid. Hashed token, pinned versions, revoke cascades to sessions. |
| OTP + session | `packages/api/src/services/reviewer-portal.service.ts` | Works. Opaque session token, hash stored, DB-checked per request. |
| Portal auth | `packages/api/src/middleware/reviewer-auth.ts` | Correct. Checks session + invitation state on every call. |
| **File delivery** | `reviewer-portal.service.ts:234` → `ReviewerWorkspace.tsx:42` | **Broken for our goal.** |
| Engagement data | — | Does not exist. `lastActivityAt` is the only signal. |
| Rasterization | — | Does not exist. Documents are parsed to text via LlamaCloud only. |

### The hole

`getFileAccess` mints a 5-minute signed Supabase URL for the **original object**. The client
then does `fetch(access.url)` → `blob()` → `URL.createObjectURL` → opens a tab. The complete,
unmodified, unwatermarked PDF is in the investor's browser. `allowDownload: false` only
disables a button in the UI; the "preview" path already handed over the same bytes.

Fixing this is not a UI change. The file must stop leaving the server.

---

## 2. Architecture: four pillars

```
┌─ 1. RASTERIZE ────────────────────────────────────────────────┐
│  On version ready, a worker renders each PDF page to WebP     │
│  and stores page images in private storage. The PDF itself    │
│  is never referenced by the portal again.                     │
└───────────────────────────────────────────────────────────────┘
┌─ 2. SERVE THROUGH THE API ────────────────────────────────────┐
│  Page images stream from our API, not from a signed storage   │
│  URL. Every single page request is authorized, watermarked,   │
│  and logged. There is no URL the investor can copy.           │
└───────────────────────────────────────────────────────────────┘
┌─ 3. BURN IDENTITY ────────────────────────────────────────────┐
│  Reviewer email + link id composited into the image pixels    │
│  server-side, before it reaches the browser. Survives         │
│  screenshots, crops, and phone photos. Not removable by       │
│  devtools, because it is not a DOM layer.                     │
└───────────────────────────────────────────────────────────────┘
┌─ 4. MEASURE EVERYTHING ───────────────────────────────────────┐
│  Client heartbeats page + visible-time; server aggregates     │
│  into per-visit, per-page rows. Founder sees visits, time     │
│  per page, drop-off, and capture attempts.                    │
└───────────────────────────────────────────────────────────────┘
```

A pleasant side effect: because the client never handles a PDF, **we do not need
`react-pdf` or `pdfjs-dist` on the frontend at all**. `reviewer-plan.md` §6 called for it;
this design removes that dependency. The viewer becomes an image scroller.

---

## 3. Pillar 1 — Rasterization pipeline

### Where it runs

Extend `packages/api/src/jobs/workers/document-processing.worker.ts`, or add a sibling
`document-rasterize.worker.ts` on its own queue. Prefer a **separate queue and worker**:
rasterization is CPU-heavy and would starve the text/embedding path if they share concurrency.

Flow, after upload confirmation:

```
version ready
  ├── document-processing queue   → LlamaCloud text → chunks → embeddings   (existing)
  └── document-rasterize queue    → page images + dimensions                (new)
```

`processingStatus: "ready"` should not flip until **both** complete, or add a separate
`renderStatus` column so text search works before images finish. Recommend a separate
`renderStatus` (`pending | rendering | ready | failed`) — a 60-page deck takes ~30s and
we do not want to block chat/AI features on it.

### Toolchain

| Need | Choice | Why |
| --- | --- | --- |
| PDF → raster | `pdfjs-dist` (legacy build) + `@napi-rs/canvas` | Prebuilt native binary via npm. No `apt-get` in the Dockerfile. Same renderer as the browser, so output matches what a user expects. |
| Encode / resize / watermark | `sharp` | Prebuilt binaries, fast WebP, and composites SVG overlays natively — which is exactly how the watermark gets burned. |
| Watermarked download PDF | `pdf-lib` | Pure JS, stamps text onto an existing PDF. Only needed when `allowDownload` is on. |

`pdf-to-img` wraps the first row if you want it in one dependency; rolling it manually is
~40 lines and gives control over scale and the canvas factory. Either is fine.

Rejected: `pdftoppm` / poppler-utils (needs system packages, and there is currently no
Dockerfile in this repo — introducing an apt dependency now is a deployment problem for
whatever platform runs the worker). Rejected: client-side pdf.js rendering — it requires
shipping the PDF, which is the thing we are eliminating.

### Output

Two renditions per page:

- **view**: longest edge 1600px, WebP q80. ~120–250 KB/page.
- **thumb**: longest edge 220px, WebP q60. ~8 KB/page, for the page-strip navigator.

Storage keys extend the existing `buildStorageKey` convention in `storage.service.ts`:

```
startups/{startupId}/documents/{documentId}/{versionId}/pages/{n}.webp
startups/{startupId}/documents/{documentId}/{versionId}/thumbs/{n}.webp
```

`isValidDocumentKey()` in `storage.service.ts:101` must be widened to accept the extra path
segment, or it will silently refuse to clean these up on document delete.

Budget check: a 40-page deck ≈ 8 MB of page images on top of a 4 MB PDF. Acceptable. Add
page-image deletion to the existing `deleteObjects` cleanup path used by document delete.

### Scope for v1

**PDF only.** `storage.service.ts:8` currently accepts DOCX/XLSX/PPTX/TXT. Those upload fine
and get parsed for AI, but the share dialog must refuse to attach a non-PDF version to an
invitation until we add LibreOffice-headless conversion (phase 5). Enforce this in
`createInvitation`, not just the UI.

---

## 4. Pillar 2 — Secure page delivery

### Endpoints

```
GET  /api/v1/reviewer-portal/documents/:versionId/manifest
     → { pageCount, pages: [{ n, w, h }], pageToken, expiresAt, policy }

GET  /api/v1/reviewer-portal/pages/:versionId/:n?t=<pageToken>
     → image/webp bytes, watermarked
```

`manifest` runs the full authorization chain already described in `reviewer-plan.md` §5:
session valid → invitation active → version present in `ReviewerInvitationDocument` for
*this* invitation. It returns a **page token**: `HMAC-SHA256(sessionId | versionId | exp)`
signed with a server secret, ~10 minute TTL.

The page endpoint requires **both** the token and the session cookie, and checks that the
token's embedded `sessionId` matches the cookie's session. Belt and braces: a token leaked
out of the page is useless without the cookie, and the cookie alone cannot enumerate
versions without a manifest call that gets authorized and logged.

> **Deployment dependency.** The cookie is `SameSite=Lax`, `Path=/api/v1/reviewer-portal`
> (`reviewer-portal.service.ts:65`). `<img>` requests carry it only if the API is same-site
> with the web app. If API and web deploy to different registrable domains, the cookie must
> become `SameSite=None; Secure` — decide this before building, it changes the CSRF posture.

Response headers on every page:

```
Cache-Control: private, no-store, max-age=0
Content-Type: image/webp
Cross-Origin-Resource-Policy: same-origin
X-Content-Type-Options: nosniff
```

`no-store` matters: it keeps pages out of the browser's HTTP cache on disk. Combined with
canvas rendering (below), there is no cached file for the investor to dig out of
`~/Library/Caches`.

### The original file

`getFileAccess` is **deleted** in its current form. It is replaced by:

- `POST /reviewer-portal/documents/:versionId/download` — only reachable when
  `allowDownload` is true. Returns a **watermarked, flattened PDF** built with `pdf-lib`
  (stamp reviewer email + timestamp on each page), not the original object. Logged as a
  `download` event.
- Nothing else. There is no code path from the portal to `createSignedReadUrl` on the
  original storage key.

That single change is the entire security fix. The rest of this document is deterrence,
forensics, and product.

---

## 5. Pillar 3 — Watermarking

### Burned layer (the real one)

Composited by `sharp` on the server before the bytes leave. A tiled diagonal SVG:

```
muhammad@acme.vc · FPF-7K2Q · 2026-08-16
```

reviewer email · short link id · date. Rendered at ~6% opacity, rotated -30°, tiled across
the page so a crop of any region still contains a full instance.

**Rendering strategy:** composite on the fly per request, cached in Redis as raw bytes
keyed `wm:{invitationId}:{versionId}:{n}` with a ~1 hour TTL. `sharp` composites in
20–50 ms; the cache absorbs re-reads during a scroll. The alternative — pre-rendering a
watermarked copy per invitation into storage — multiplies storage by the number of
invitations and needs its own GC job. On-the-fly wins.

The burned text deliberately excludes the exact time so the cache stays valid; the live
clock goes in the overlay.

### Overlay layer (cosmetic + live)

A CSS layer above the canvas showing the live timestamp and session id. Trivially removable
in devtools — that is fine. Its job is to make the viewer *aware* they are identified,
which is most of the deterrent effect. The burned layer is what survives.

### Per-link control

`watermarkEnabled` on the invitation, default **on**. Founders sharing a public one-pager
may want it off.

---

## 6. Pillar 4 — The viewer and capture deterrence

### Rendering

Continuous vertical scroll of pages. Each page:

1. Fetch the page endpoint as a blob.
2. `createImageBitmap` → draw into a `<canvas>` → **immediately** `URL.revokeObjectURL`.
3. Never mount an `<img>` with a live `src`.

Canvas kills "right click → Save image as", kills drag-to-desktop, and means the DOM does
not hold a URL that reproduces the page. Virtualize: keep ±2 pages rendered, blank the rest.

Optional extra: slice each page into 4 horizontal strips server-side and reassemble on the
canvas, so no single fetched object is a full page. Real but marginal gain against a
scripted scraper; costs 4× the requests. **Recommend skipping in v1**, revisit if abuse appears.

### Deterrents, and what each actually does

| Control | Effect | Honest rating |
| --- | --- | --- |
| Canvas render, no `<img>`, revoked blob URLs | Blocks save-image, drag-out, cache scraping | **Real** |
| `user-select: none`, `oncontextmenu` blocked, copy/cut blocked | Blocks text selection and right-click | **Real** (there is no text layer anyway) |
| `@media print { * { display: none } }` + `beforeprint` blanking + Ctrl/Cmd+P intercept | Blocks print-to-PDF | **Mostly real** — headless/devtools print can bypass |
| Blur page on `blur` / `visibilitychange` | Defeats Snipping Tool, Cmd+Shift+4, any tool needing an app switch | **Partial, genuinely useful** |
| `PrintScreen` keyup → blank + clipboard overwrite | Windows/Chromium only. `keyup` fires; `keydown` often does not | **Partial** |
| macOS Cmd+Shift+3/4/5 detection | The OS intercepts these system-wide. The browser **does not** receive them | **Does not work — do not claim it** |
| Mobile screenshots | No web API exists. Nothing to hook | **Impossible** |
| Phone camera at the screen | — | **Impossible** |
| Devtools-open heuristics | Noisy, false-positives on responsive tooling | **Log only, never block** |

Every one of these fires a logged event whether or not it succeeded. **The event log is the
product feature.** "Sequoia attempted a screenshot on slide 12" is something a founder will
pay for; a promise that the screenshot was blocked is something we cannot honestly make.

Set the notice on the access screen accordingly: *"This document is watermarked with your
email address. Your activity is recorded and shared with the sender."* That sentence deters
better than every technical control on this list combined, and it is the GDPR disclosure.

### CSP

The portal needs a strict, dedicated policy — the app's global `helmet` config is not
sufficient. `default-src 'self'`, `img-src 'self' blob:`, `object-src 'none'`,
`frame-ancestors 'none'` (stops the portal being iframed into a capture harness).

---

## 7. Analytics

> **This amends `reviewer-plan.md` §4**, which says *"Do not record mouse movement, reading
> time guesses, or other invasive analytics."* That line was written for a feedback tool.
> The product being asked for is a data-room analytics product, where per-page dwell time
> *is* the feature. The line should be replaced with a disclosure-and-retention rule rather
> than a prohibition. Flagging explicitly so the change is deliberate.

### Collection

Client keeps a small state machine: which page is centered in the viewport, whether the tab
is visible, whether the window is focused. Accumulates active-milliseconds against the
current page — **paused when hidden or blurred**, so "left the tab open overnight" does not
read as 8 hours of engagement. That distinction is what separates real analytics from
vanity numbers.

Flush every 10s and on `pagehide` via `navigator.sendBeacon`:

```
POST /api/v1/reviewer-portal/telemetry
{
  visitId,
  pages: [{ versionId, pageNumber, activeMs, enteredAt, exits }],
  events: [{ type, versionId?, pageNumber?, at, meta }]
}
```

Server-side hardening, because this endpoint is client-controlled and public-facing:

- Clamp `activeMs` per page per flush to wall-clock since the last flush. A hostile client
  cannot inflate engagement.
- Rate limit per session (Redis, the repo already has `rate-limit-redis`).
- Validate `versionId` against the invitation's pinned set — same IDOR rule as everywhere else.
- Cap `events` per flush; drop the overflow rather than erroring.

### Data model

**Aggregate on write.** One row per `(visit, version, page)`, upserted — not one row per
heartbeat. A 40-page deck read twice produces 40 rows, not 4,000.

```prisma
model ReviewerVisit {
  id            String   @id @default(uuid())
  startupId     String
  invitationId  String
  sessionId     String
  startedAt     DateTime @default(now())
  lastSeenAt    DateTime
  endedAt       DateTime?
  totalActiveMs Int      @default(0)
  pagesViewed   Int      @default(0)
  maxPageReached Int     @default(0)
  completionPct Int      @default(0)   // distinct pages seen / total pages
  deviceType    String?                // desktop | mobile | tablet
  os            String?
  browser       String?
  deviceHash    String?                // keyed hash of a coarse UA+screen fingerprint
  ipHash        String?                // HMAC, never the raw IP
  countryCode   String?
  city          String?
  referrer      String?
  suspectedForward Boolean @default(false)

  @@index([invitationId, startedAt])
  @@index([startupId, startedAt])
}

model ReviewerPageView {
  id                String   @id @default(uuid())
  visitId           String
  documentVersionId String
  pageNumber        Int
  firstViewedAt     DateTime
  lastViewedAt      DateTime
  activeMs          Int      @default(0)
  viewCount         Int      @default(1)   // separate entries into the page

  @@unique([visitId, documentVersionId, pageNumber])
  @@index([documentVersionId, pageNumber])
}

model ReviewerEvent {
  id                String   @id @default(uuid())
  startupId         String
  invitationId      String
  visitId           String?
  type              String
  documentVersionId String?
  pageNumber        Int?
  metadata          Json?
  createdAt         DateTime @default(now())

  @@index([invitationId, createdAt])
  @@index([startupId, type, createdAt])
}

model DocumentPage {
  id                String @id @default(uuid())
  documentVersionId String
  pageNumber        Int
  width             Int
  height            Int
  storageKey        String
  thumbStorageKey   String
  storageProvider   String @default("supabase")

  @@unique([documentVersionId, pageNumber])
}
```

Plus new columns on `ReviewerInvitation`:

```
watermarkEnabled     Boolean @default(true)
screenshotGuard      Boolean @default(true)
allowPrint           Boolean @default(false)
requireNda           Boolean @default(false)
ndaText              String?
ndaAcceptedAt        DateTime?
passwordHash         String?     // optional second factor beyond OTP
notifyOnOpen         Boolean @default(true)
```

Event types: `link_opened`, `otp_requested`, `otp_verified`, `otp_failed`, `nda_accepted`,
`document_opened`, `download_completed`, `download_blocked`, `print_attempt`,
`screenshot_attempt`, `copy_attempt`, `devtools_suspected`, `review_completed`,
`scope_changed`, `access_revoked`, `forward_suspected`.

### Forwarding detection

Two or more distinct `deviceHash` values, or distinct `ipHash` from different countries,
under one invitation → set `suspectedForward`, emit `forward_suspected`, notify the founder.
This is the feature that makes founders trust the tool. Note it is a *signal*, not proof —
present it as "opened from 2 devices", never as an accusation.

### Founder-facing surfaces

Charts use `recharts`, already a dependency — no new frontend packages.

**Invitation detail → new Analytics tab**
- Header stats: visits, total time, last seen, completion %, device/location.
- **Per-page time bar** — the DocSend signature view. Horizontal bar per page, length =
  seconds. This one chart is the reason people buy the category.
- Visit timeline: each session expandable into its page-by-page path.
- Security row: screenshot attempts, print attempts, download events, forward signal.

**Document detail → new Analytics tab** (aggregate across all reviewers)
- Drop-off curve: % of viewers who reached page N. Shows exactly where the deck loses people.
- Average time per page, ranked. Most-lingered slide, most-skipped slide.
- Viewer leaderboard by total time — the "who is actually interested" list.

**Reviewers index**
- Sortable by engagement, not just recency.
- "Hot" badge for a reviewer with a return visit or >2× median time.

**Real-time notification**: "Ahmed at Sequoia is reading your deck right now." Fires on
`document_opened` through the existing notification + email queue. High perceived value,
low build cost, gated by `notifyOnOpen`.

### Retention

- Raw `ReviewerEvent`: 12 months, then delete.
- `ReviewerPageView` / `ReviewerVisit`: keep aggregates, null out `ipHash`/`deviceHash`/`city`
  after 90 days.
- Never store raw IP. HMAC with a server key at write time.
- Add to the existing `node-cron` cleanup schedule.

---

## 8. API surface

**Reviewer portal** (session + origin checked, `no-store`)
```
GET    /reviewer-portal/documents/:versionId/manifest
GET    /reviewer-portal/pages/:versionId/:n?t=<token>
POST   /reviewer-portal/telemetry
POST   /reviewer-portal/nda/accept
POST   /reviewer-portal/documents/:versionId/download      // 403 unless allowDownload
DELETE /reviewer-portal/documents/:versionId/file-access   // remove existing endpoint
```

**Founder** (`requireMember` + `documents:read`, startup-scoped)
```
GET /startups/:startupId/reviewer-invitations/:id/analytics
GET /startups/:startupId/reviewer-invitations/:id/visits
GET /startups/:startupId/documents/:documentId/analytics
GET /startups/:startupId/reviewer-analytics/overview
```

Update `packages/api/openapi.yaml` in the same change, then regenerate
`packages/web/src/lib/api-types.ts` via `npm run gen:api-types -w @starter-kit/web`.

---

## 9. Phasing

**Phase 1 — Close the hole.** *This is the only phase that is a security fix.*
- [ ] `DocumentPage` model + migration + `renderStatus` on `DocumentVersion`.
- [ ] Rasterize worker + queue (`pdfjs-dist`, `@napi-rs/canvas`, `sharp`).
- [ ] Manifest + page endpoints with HMAC page tokens.
- [ ] Delete `getFileAccess`; rebuild `ReviewerWorkspace` as a canvas page scroller.
- [ ] Widen `isValidDocumentKey`; add page images to delete cleanup.
- [ ] Block non-PDF versions from being attached to invitations.
- [ ] Tests: reviewer A cannot fetch reviewer B's pages; unpinned version returns 404;
      no route from the portal reaches the original storage key.

**Phase 2 — Identity and deterrence.**
- [ ] `sharp` watermark compositing + Redis byte cache.
- [ ] Live overlay, disclosure notice on the access screen.
- [ ] Client guards: contextmenu, copy, print, blur-on-blur, PrintScreen.
- [ ] `ReviewerEvent` model; every guard fires an event.
- [ ] Portal CSP.

**Phase 3 — Analytics.**
- [ ] `ReviewerVisit` / `ReviewerPageView` + telemetry endpoint with server-side clamping.
- [ ] Client heartbeat state machine (visible + focused only).
- [ ] Invitation Analytics tab: stats, per-page bar, visit timeline, security row.
- [ ] Document Analytics tab: drop-off curve, per-page averages, viewer leaderboard.
- [ ] `notifyOnOpen` real-time notification.

**Phase 4 — Link controls.**
- [ ] NDA gate, optional password, email-domain allowlist, print/download policy.
- [ ] Forwarding detection + founder alert.
- [ ] Watermarked download PDF via `pdf-lib`.

**Phase 5 — Scale and hardening.**
- [ ] LibreOffice-headless conversion for DOCX/PPTX → PDF → raster.
- [ ] Daily rollup table if cross-reviewer aggregates get slow (defer until measured).
- [ ] Retention cron; IP/device anonymization.
- [ ] Load test rasterization on a 100-page PDF; cap page count per document.

---

## 10. Decisions

**Settled 2026-08-16:**

1. **Deployment is same-site** — API and web share a registrable domain (e.g. `app.x.com` +
   `api.x.com`). The reviewer session cookie stays `SameSite=Lax`, `Path=/api/v1/reviewer-portal`,
   and is therefore sent automatically with `<img>`/`fetch` requests to the page endpoint.
   The HMAC page token remains as the second factor, not as a cookie substitute. Production
   `CORS_ORIGIN` must be set to the web origin; the current default in
   `packages/api/app.ts:27` is a localhost dev fallback.
2. **Watermark burns email + short link id + date.** `muhammad@acme.vc · FPF-7K2Q · 2026-08-16`.
   No per-link opt-out of the *content* in v1 — `watermarkEnabled` still toggles the whole
   watermark on or off.
3. **Build order: Phase 1 alone first.** Close the file leak before anything else ships.

**Still open:**

4. **Pinned versions vs. live.** Current model pins a version per invitation. DocSend updates
   the doc under the viewer. Recommend keeping the pin (it is what keeps feedback anchored)
   and adding the explicit "share new version" action from `reviewer-plan.md` §3.2.
5. **Page-count cap.** Rasterizing a 500-page data room is a DoS on our own worker. Suggest
   a 200-page cap with a clear error. Needs a number before phase 1 ships.
6. **`reviewer-plan.md` §4 amendment.** The no-invasive-analytics line must be rewritten
   before phase 3, or the two documents contradict each other.
