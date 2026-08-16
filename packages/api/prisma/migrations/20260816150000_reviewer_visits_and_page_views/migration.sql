-- Phase 3 (backend) of the reviewer secure-viewer plan: analytics data collection.
--
-- A visit maps 1:1 to a reviewer session (see reviewer-portal.service.ts
-- recordTelemetry) rather than a client-chosen id, so `session_id` is unique.
-- Page views are keyed per (visit, version, page) and upserted on every
-- telemetry flush rather than storing one row per heartbeat.

CREATE TABLE IF NOT EXISTS "reviewer_visits" (
  "id"               TEXT NOT NULL,
  "startup_id"       TEXT NOT NULL,
  "invitation_id"    TEXT NOT NULL,
  "session_id"       TEXT NOT NULL,
  "started_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"     TIMESTAMP(3) NOT NULL,
  "ended_at"         TIMESTAMP(3),
  "total_active_ms"  INTEGER NOT NULL DEFAULT 0,
  "pages_viewed"     INTEGER NOT NULL DEFAULT 0,
  "max_page_reached" INTEGER NOT NULL DEFAULT 0,
  "completion_pct"   INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "reviewer_visits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "reviewer_visits_session_id_key"
  ON "reviewer_visits"("session_id");

CREATE INDEX IF NOT EXISTS "reviewer_visits_invitation_id_started_at_idx"
  ON "reviewer_visits"("invitation_id", "started_at");

CREATE INDEX IF NOT EXISTS "reviewer_visits_startup_id_started_at_idx"
  ON "reviewer_visits"("startup_id", "started_at");

ALTER TABLE "reviewer_visits"
  DROP CONSTRAINT IF EXISTS "reviewer_visits_invitation_id_fkey";

ALTER TABLE "reviewer_visits"
  ADD CONSTRAINT "reviewer_visits_invitation_id_fkey"
  FOREIGN KEY ("invitation_id") REFERENCES "reviewer_invitations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "reviewer_page_views" (
  "id"                   TEXT NOT NULL,
  "visit_id"             TEXT NOT NULL,
  "document_version_id"  TEXT NOT NULL,
  "page_number"          INTEGER NOT NULL,
  "first_viewed_at"      TIMESTAMP(3) NOT NULL,
  "last_viewed_at"       TIMESTAMP(3) NOT NULL,
  "active_ms"            INTEGER NOT NULL DEFAULT 0,
  "view_count"           INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "reviewer_page_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "reviewer_page_views_visit_id_document_version_id_page_numb_key"
  ON "reviewer_page_views"("visit_id", "document_version_id", "page_number");

CREATE INDEX IF NOT EXISTS "reviewer_page_views_document_version_id_page_number_idx"
  ON "reviewer_page_views"("document_version_id", "page_number");

ALTER TABLE "reviewer_page_views"
  DROP CONSTRAINT IF EXISTS "reviewer_page_views_visit_id_fkey";

ALTER TABLE "reviewer_page_views"
  ADD CONSTRAINT "reviewer_page_views_visit_id_fkey"
  FOREIGN KEY ("visit_id") REFERENCES "reviewer_visits"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
