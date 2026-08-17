-- Phase 2 of the reviewer secure-viewer plan: identity and deterrence.
--
-- `watermark_enabled` is the one per-link toggle this phase reads (the other
-- future link controls in the plan land with Phase 4). `reviewer_events`
-- records capture-deterrent attempts (copy, print, screenshot) fired by the
-- viewer's client-side guards.

ALTER TABLE "reviewer_invitations"
  ADD COLUMN IF NOT EXISTS "watermark_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "reviewer_events" (
  "id"                   TEXT NOT NULL,
  "startup_id"           TEXT NOT NULL,
  "invitation_id"        TEXT NOT NULL,
  "session_id"           TEXT NOT NULL,
  "type"                 TEXT NOT NULL,
  "document_version_id"  TEXT,
  "page_number"          INTEGER,
  "metadata"             JSONB,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reviewer_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reviewer_events_invitation_id_created_at_idx"
  ON "reviewer_events"("invitation_id", "created_at");

CREATE INDEX IF NOT EXISTS "reviewer_events_startup_id_type_created_at_idx"
  ON "reviewer_events"("startup_id", "type", "created_at");

ALTER TABLE "reviewer_events"
  DROP CONSTRAINT IF EXISTS "reviewer_events_invitation_id_fkey";

ALTER TABLE "reviewer_events"
  ADD CONSTRAINT "reviewer_events_invitation_id_fkey"
  FOREIGN KEY ("invitation_id") REFERENCES "reviewer_invitations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
