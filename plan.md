# Google Integration — Automatic Interaction Logging

Logging an interaction is currently entirely manual: open a dialog, pick a type,
set a date, write a subject and notes, one investor at a time. This plan removes
that step for the two interaction types that carry the most weight — meetings and
emails — by connecting the founder's Google account.

Two features, one shared foundation:

- **Calendar → meetings.** Read past calendar events, match attendees against
  investor contacts, and write the interaction automatically.
- **Gmail → emails.** Send investor email from our own UI as the founder, and
  treat the send itself as the log.

Calendar comes first. Attendee matching is an exact email comparison, a founder's
calendar carries a handful of events a day rather than hundreds of messages, and
`meeting` already exists in `INTERACTION_TYPES` — so it delivers auto-logging with
the least new machinery. Gmail send reuses the same OAuth foundation.

**Outlook is deliberately out of scope.** The connection model should stay
provider-shaped so that adding one later is additive rather than a rewrite.

## Scope tiers — the constraint that shapes everything

Google splits OAuth scopes into *sensitive* (app verification: brand review, demo
video, privacy policy — slow but free) and *restricted* (verification **plus** an
annual third-party CASA security assessment, which costs real money).

- `calendar.events.readonly` — sensitive
- `gmail.send` — sensitive
- `gmail.readonly` — **restricted**

This is why we capture emails by *sending* them rather than by reading the inbox.
The consequence is deliberate and worth stating plainly: **inbound replies are not
logged.** Only mail the founder sends from our UI is captured. Re-confirm the
current classification against Google's policy before committing to the work — it
shifts.

## Phase 1 — Google connection foundation

Goal: one reversible, secure Google connection per user that both features build on.

The existing Google login cannot be widened to cover this. It verifies a
client-side ID token (`auth.service.ts:367`) and never receives a refresh token,
so offline access needs a separate authorization-code flow.

- [x] Add a `GoogleConnection` model: one row per user, holding the encrypted
      refresh token, granted scopes, the connected Google address, calendar sync
      state, and a status of `active` / `needs_reauth` / `revoked`.
      (`prisma/schema.prisma` — also carries `calendarSyncToken`/`lastSyncedAt`/
      `lastError` up front so Phase 2 doesn't need another migration.)
- [x] Add `packages/api/src/utils/crypto.ts` — AES-256-GCM encrypt/decrypt behind a
      new `GOOGLE_TOKEN_ENCRYPTION_KEY`, registered in `config/env.ts` alongside the
      other required secrets. (Validated as a 64-char hex string at boot, and
      `config/env.ts` refuses to start on a *partial* Google config — some but not
      all of `GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`/`GOOGLE_TOKEN_ENCRYPTION_KEY`
      set — since that would fail deep inside an OAuth exchange instead of at boot.)
- [x] Add an `integrations` router mounted in `routes/index.ts`: start the consent
      flow, handle the callback, and disconnect. (Also a `GET /google/status` the
      Settings card reads.)
- [x] Request consent with `access_type=offline` and `prompt=consent`, so a
      re-connect reliably returns a refresh token rather than silently omitting one.
- [x] Bind the OAuth `state` value to the user with a short Redis TTL, so the
      callback cannot be driven by a third party. (10 minutes, one-time use — the
      callback deletes the key the instant it reads it, success or failure.)
- [x] Add an access-token helper that exchanges the refresh token on demand and
      caches the result in Redis for its lifetime. (`getValidAccessToken` — caches
      until 60s before Google's own expiry, floor of 60s either way.)
- [x] Treat `invalid_grant` (the user revoked access at Google) as `needs_reauth`
      and notify — never as a generic sync failure. (The status flip and UI badge
      are done; nothing calls `getValidAccessToken` yet since Phase 2/3 don't exist,
      so this is proven by unit test rather than by a real revoke today. A
      `Notification` row on the flip — not just the Settings badge — is deferred to
      whichever of Phase 2/3 lands first, since that's the first real caller.)
- [x] Add a "Connected accounts" card to `Settings.tsx`: connect, disconnect, the
      connected Google address, and the last successful sync. (Last-sync display
      has nothing to show until Phase 2 writes to `lastSyncedAt` — the card reads
      the field already, so no further UI change is needed when that lands. The
      status endpoint also reports whether this deployment has the integration
      configured at all, so the card replaces the Connect button with a plain
      explanation rather than a button that would 503 when it isn't.)
- [x] Disconnecting must revoke the grant at Google, not just delete our row.
      (Revoke is attempted first; a failure there — already revoked, network error —
      still clears our row rather than leaving a disconnect the user can't retry.
      Not yet exercised against a real connection — see below.)

**Decision — connection scope.** The connection belongs to a *user*, but
interactions belong to a *startup*. A founder in several workspaces connects once,
and sync fans out to every startup where they are an active member. Forcing a
reconnect per workspace would be worse for a real multi-workspace founder.

Acceptance criteria:

- Connecting and disconnecting are both reachable from Settings and leave no
  orphaned tokens on either side. _(Connect verified live — see below. Disconnect
  still only unit-tested.)_
- A refresh token is never logged, never returned by any endpoint, and is
  unreadable without the encryption key. _(Verified against the real stored row:
  the `refresh_token_cipher` column is an opaque base64 blob, and decrypting it
  with `GOOGLE_TOKEN_ENCRYPTION_KEY` recovers a token in Google's real `1//...`
  offline-token format — so the encrypt/decrypt path works on real Google output,
  not just synthetic test bytes.)_
- A connection revoked at Google surfaces in the UI as "needs reconnect". _(Wired
  end to end and unit-tested against a mocked `invalid_grant`, but nothing in the
  running app calls `getValidAccessToken` before Phase 2/3 exist — so this hasn't
  been exercised against a real revoke yet.)_

**Verified live** (2026-08-14, against a real Google Cloud OAuth client and
muhamad.houda@gmail.com): connect → consent screen → callback → Settings shows
"Connected" all worked end to end on the first real pass. `GET
/integrations/google/status` afterward confirmed `connected: true`, the correct
Google email, `status: "active"`, and all four granted scopes (`openid`,
`userinfo.email`, `calendar.events.readonly`, `gmail.send`). The one Phase 1
redirect-URI risk called out earlier — `redirect_uri_mismatch` from an
unregistered callback — did not occur, so the Cloud Console config matches.

**Still open before Phase 2/3 lean on this:** disconnect (revoke-then-delete) and
the `needs_reauth` flip on a real revoked grant have only run against mocks, not
this live connection. Worth exercising both once — disconnect from Settings, then
reconnect — before building Calendar sync on top.

## Phase 2 — Calendar sync → meetings

Goal: a past meeting with an investor appears on their timeline with no manual step.

Scope: `https://www.googleapis.com/auth/calendar.events.readonly`

- [x] Add `source` (`manual` / `google_calendar` / `gmail`) and `externalId` to
      `InteractionLog`, unique per contact, so a re-sync can never duplicate a row.
      (Also added `editedByUser` — needed to make the retraction rule below actually
      implementable; see its own note.)
- [x] Add a calendar-sync queue and worker alongside the existing BullMQ jobs, with
      a cron tick enqueueing one job per active connection. (Every 30 minutes,
      skipped entirely when the integration isn't configured. Job id is
      `calendar-sync:${userId}`, so if a sync is still running when the next tick
      fires, BullMQ reuses the in-flight job instead of stacking a second one.)
- [x] Sync incrementally with Google's `syncToken` stored on the connection; fall
      back to a bounded full fetch on first run or when Google expires the token.
      **Corrected after live testing — see the callout below the checklist.** The
      "bounded full fetch" half of this line as originally written turned out to be
      impossible: Google will not issue a `syncToken` for a time-bounded query at
      all, discovered by hitting the real Calendar API, not by reasoning about the
      docs. The bootstrap walk is unbounded (required to get a token), and the
      90-day window is now enforced per-event afterward instead.
- [x] Only log events whose **end time has passed** — a meeting that later moves or
      is cancelled must not already be on the timeline.
- [x] Match attendee emails against `StartupInvestor` per startup. Contacts without
      an email simply never match, which is correct. (Case-insensitive compare —
      Google's attendee emails and a hand-typed investor email aren't guaranteed to
      agree on case.)
- [x] Skip cancelled events, events the founder declined, and all-day entries.
- [x] Treat each instance of a recurring event as its own interaction.
      (`singleEvents: true` — Google expands recurrence into individually-addressable
      instances, each with its own event id, which is exactly the externalId this
      needs.)
- [x] Link the log to the investor's deal in the startup's active round when one
      exists, so it lands on the deal timeline too.
- [x] Retract a synced log if its event is later cancelled — but only when the log
      is still untouched and still `google_calendar`. ("Untouched" needed its own
      signal: `editedByUser`, set only by the human-facing PATCH endpoint, never by
      sync. Comparing timestamps instead would have broken the first time sync
      updated a row it had already written, since that write would itself look like
      an edit.)
- [x] Mark synced entries in `InteractionTimeline`, and support pausing sync and
      bulk-removing synced entries. (Pause is a dedicated `calendarSyncEnabled` flag
      on the connection, separate from `status` — "I don't want this right now" is a
      different fact than "this is broken," and Gmail send in Phase 3 must not
      inherit a calendar-only pause. Bulk-remove has no dedicated backend endpoint —
      it reuses the existing single-delete endpoint through the same client-side
      concurrency helper `Investors.tsx` already uses for bulk-add, rather than
      introducing a new bulk API shape for one Settings action.)

**Decision — auto-create, not a review queue.** An attendee email match is exact,
and calendar volume is low, so precision is high enough to write directly. The
`source` field is what makes that safe: synced entries stay visually distinct and
removable in bulk. A review queue would reintroduce the manual step this plan
exists to delete.

**Privacy — persist only what matched.** Events that match no investor are
discarded and never written to the database. This is both the right default and
the strongest possible answer during Google's verification review.

**Corrected mid-build — the sync-token bootstrap is necessarily unbounded.**
The original plan was to keep even the *first* sync small by sending `timeMin`
(a 90-day window) on the bootstrap request. Tested live against a real Google
Calendar with real credentials: a `timeMin`-bounded request **never** returns a
`nextSyncToken`, even on its last page — confirmed by paging both a bounded and
an unbounded request to completion side by side and comparing. Google's
incremental-sync contract requires walking the calendar with no time bound at
least once to obtain a usable cursor; there is no way to bound *that* request and
still get one. So:
- The bootstrap walk (no stored `calendarSyncToken`) now sends no `timeMin` and no
  `orderBy` — full history, capped at 40 pages (10,000 events) as a safety bound,
  not a product one.
- The 90-day recency window moved from a query parameter to a per-event filter
  applied after the fetch — functionally the same outcome (nothing older than 90
  days gets logged), just enforced after Google hands the events back instead of
  before.
- A calendar with more than ~10,000 events in its entire history would not finish
  bootstrapping in one cron tick, and — since page-level position isn't persisted
  across ticks — would restart the walk from page one next time rather than
  resuming. Flagged as a known limitation rather than solved: worth revisiting if
  a real founder's calendar actually hits it, not worth the added state before
  anyone has.

This is exactly the kind of thing that only live-testing catches — the unit tests
passed the whole time, because they were asserting against my own (wrong)
assumption about Google's behavior, not against Google itself.

Acceptance criteria:

- A past meeting with an investor attendee reaches that investor's timeline within
  one sync cycle, with no manual step. _(Verified live: attendee-matching, deal-
  linking, and log-writing all ran against the real API with zero errors. Zero
  logs were actually created in this pass only because no real calendar event's
  attendee list happened to match a seeded @example.com investor address — a
  correct outcome given the seed data, not a failure of the matching logic
  itself, which is what the 24 unit tests exercise directly.)_
- Re-running a sync never duplicates a log, and a cancelled meeting leaves no
  phantom interaction. _(Unit-tested: dedupe via the composite unique key, and
  retraction scoped to `editedByUser: false`. Not yet exercised against a real
  cancelled meeting — would need one deliberately cancelled and re-synced to
  prove live.)_
- No event that matched no investor is ever persisted. _(True by construction —
  `upsertMeetingLog` is only ever called from inside the per-investor match loop,
  so there's no code path that could write a row without a match. Also true in
  practice: the live pass processed 9 real events and persisted zero.)_
- Disconnecting stops future sync and leaves already-logged meetings in place.
  _(Not yet exercised — Phase 1 already flagged disconnect as unverified live, and
  that's still open.)_

**Live-verified** (2026-08-14, against muhamad.houda@gmail.com's real calendar,
via the "Sync now" trigger endpoint): first pass caught the sync-token bug above
and got fixed on the spot; second pass persisted a real `calendarSyncToken`; third
pass completed in 0.35s versus several seconds for the first two — direct
confirmation that incremental sync is genuinely incremental, not a full walk
wearing a syncToken.

**Not yet live-verified:** cancellation retraction (needs a real meeting cancelled
and re-synced), the `needs_reauth` flip on a real revoked grant (carried over from
Phase 1), and disconnect (also carried over from Phase 1).

## Phase 3 — Gmail send → emails

Goal: the founder sends investor email from our UI, and the send *is* the log.

Scope: `https://www.googleapis.com/auth/gmail.send`

- [x] Add a compose action to the investor and deal detail dialogs, with the
      recipient prefilled from the investor's stored email. (`ComposeEmailDialog` —
      one shared component, since both dialogs needed the identical subject/body
      form. Plain text only, matching every other free-text field in the workspace
      — notes, interaction descriptions — rather than adding the app's first
      rich-text editor for one dialog.)
- [x] Add a send endpoint that builds an RFC 2822 message and posts it to Gmail's
      `messages.send`. (Direct `fetch` against the REST endpoint, no `googleapis`
      dependency — same choice already made for Calendar in Phase 2. The MIME body
      is always base64-encoded regardless of content, which sidesteps picking
      7bit/quoted-printable/8bit per message; `Subject`/`From` display name are
      RFC 2047-encoded only when non-ASCII, so a plain English subject stays
      human-readable in a raw-header view.)
- [x] Write the interaction log in the same request path — type `email`, source
      `gmail`, `externalId` set to the returned Gmail message id. No dialog. (Also
      auto-links the deal in the investor's active round when the caller doesn't
      supply a `pipelineId` explicitly — same fallback Calendar sync uses, so a
      send from the Investor page, which has no deal context, still lands on the
      deal timeline. Confirmed live: the log auto-linked correctly to a real deal.)
- [x] Store the Gmail `threadId` so a follow-up can continue the same thread.
      (Needed a second field beyond `threadId` alone: `emailMessageId`, the RFC 2822
      `Message-ID` we generate ourselves for every send — Gmail's internal message
      `id` is not the same value threading headers need. A follow-up sets
      `In-Reply-To`/`References` to the prior `emailMessageId` and passes the prior
      `threadId` in the API call. **Verified live, not just unit-tested**: sent two
      real messages to the same address; the second's response carried the exact
      same `threadId` as the first — Gmail's own confirmation the thread merge
      worked, not just that our request claimed it should.)
- [x] Restrict recipients to the investor's stored address. Arbitrary `To` values
      would turn the endpoint into an open relay under the founder's own identity.
      (True by construction — the input type has no `to` field at all; the address
      is read server-side from the investor row.)
- [x] Cap sends per user per hour using the existing rate-limiter middleware.
      (New `emailSendRateLimiter`, 30/hour, keyed by `userId` rather than IP — the
      risk is one account damaging the founder's own Gmail sending reputation, which
      an IP-keyed limit would either miss on a rotating IP or wrongly punish everyone
      behind a shared office IP. This is also the limiter that caught a real
      regression: four pre-existing controller tests mock the whole `rate-limiter`
      module and didn't know this export existed, so Express failed to boot with
      "requires a callback function but got undefined" until their mocks were
      updated — a genuine break in existing coverage, not a new-code bug.)
- [x] Disable compose with a stated reason when the account is not connected or the
      investor has no email — never a silently inert button. (Both dialogs read
      Google connection status through a new shared `useGoogleConnectionStatus`
      hook — pulled out of `ConnectedAccountsCard` specifically so Settings and the
      two compose entry points share one cached query instead of three independent
      fetches of the same fact. The button stays visible and disabled with a
      `title` explaining why, rather than disappearing — consistent with "never a
      silently inert button.")
- [ ] Optional: a small set of starting templates (intro, follow-up, investor
      update) with investor and round variables. Skipped — explicitly optional in
      the plan, and nothing in this pass called for it.

**Failure ordering.** Send first, then write the log with the returned message id.
A failed send must leave no log. If the send succeeds but the log write fails,
retry it on the queue — `externalId` uniqueness makes that retry safe.
_(Implemented exactly this way and unit-tested directly: a failed send never calls
`interactionLog.create`; a log-write failure after a successful send enqueues
`gmail-log-retry` and still reports the send as successful to the founder — an
email that truly sent must never be reported as failed just because our own
bookkeeping hiccuped afterward.)_

Acceptance criteria:

- Mail sent from the UI arrives from the founder's own address and appears in their
  Gmail Sent folder. _(Live-verified: `From` is set to the connected Google
  address, and the send succeeded through the real Gmail API using the real OAuth
  connection from Phase 1.)_
- Every successful send produces exactly one interaction log; a failed send
  produces none. _(Live-verified for the success path — the log row matched the
  send exactly, including the auto-linked deal. The failure path and the queued-
  retry path are unit-tested but not yet forced to happen against the real API.)_
- Compose is unavailable, with a reason, when there is no connection or no address.

**Live-verified** (2026-08-14, against muhamad.houda@gmail.com): both Calendar
(Phase 2) and Gmail required enabling their respective APIs on the Google Cloud
project separately from the OAuth client itself — a 403 with Google's own
"has not been used in project ... enable it by visiting ..." message, the same
shape both times. Worth calling out for Phase 4: **a real founder self-serving
through Google Cloud Console will hit this exact same wall on both APIs**, and
nothing in the product currently explains it — the error message forwards
Google's own text, which is accurate but written for a developer, not a founder.
Once past that, two real messages sent successfully, threaded correctly (confirmed
by Gmail returning the same `threadId` twice), and the interaction log wrote
correctly including deal auto-linking. Verified using a seeded investor whose
email was temporarily pointed at a real inbox for the test and restored to its
original `@example.com` value immediately after — the demo dataset is unchanged.

## Phase 4 — Verification and rollout

Goal: make the integration usable by real founders rather than only by test accounts.

- [ ] Publish the privacy policy and terms URLs the OAuth consent screen requires.
- [ ] Document precisely what is read and what is retained, for the review.
- [ ] Submit for Google app verification for both sensitive scopes.
- [ ] Run a private beta on the pre-verification test-user allowance (~100 accounts
      added manually) while verification is pending.
- [ ] Add a kill switch that disables both integrations without a deploy.
- [ ] Surface per-connection last sync time and last error for support.

Acceptance criteria:

- A founder outside our own accounts can connect, sync, and send without seeing an
  unverified-app warning.
- Both integrations can be turned off without a deploy.

## Open questions

- **Cross-workspace matches.** One event can match investors in two startups.
  Current thinking: log it in both — the meeting genuinely relates to both — but
  confirm against a real multi-workspace case.
- **Identity mismatch.** A founder may sign in with one address and connect a
  different Google account. Store and display the connected address so the
  distinction is visible rather than surprising.
- **Backfill.** Do we sync history on first connect, or only forward? A bounded
  backfill (say 90 days) makes the feature feel immediately valuable, at the cost
  of writing a burst of logs a founder never reviewed.
