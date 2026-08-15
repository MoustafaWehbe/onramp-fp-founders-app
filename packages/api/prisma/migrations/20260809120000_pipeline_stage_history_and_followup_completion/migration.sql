-- Follow-up completion + pipeline stage history.
--
-- 1. interaction_logs.followup_completed_at a follow-up is outstanding while
--    this is null, so an old nextFollowupDate stops reading as overdue forever.
-- 2. pipeline.stage_changed_at time-in-stage. updated_at cannot serve, it
--    moves whenever the amount or probability is edited.
-- 3. pipeline_stage_events append-only history, the only way to answer
--    "how many deals that reached a meeting went on to diligence".

ALTER TABLE "interaction_logs"
  ADD COLUMN "followup_completed_at" TIMESTAMP(3);

ALTER TABLE "pipeline"
  ADD COLUMN "stage_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "pipeline_stage_events" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "from_stage" TEXT,
    "to_stage" TEXT NOT NULL,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pipeline_stage_events_startup_id_created_at_idx"
  ON "pipeline_stage_events"("startup_id", "created_at");

CREATE INDEX "pipeline_stage_events_pipeline_id_created_at_idx"
  ON "pipeline_stage_events"("pipeline_id", "created_at");

ALTER TABLE "pipeline_stage_events"
  ADD CONSTRAINT "pipeline_stage_events_startup_id_fkey"
  FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pipeline_stage_events"
  ADD CONSTRAINT "pipeline_stage_events_pipeline_id_fkey"
  FOREIGN KEY ("pipeline_id") REFERENCES "pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pipeline_stage_events"
  ADD CONSTRAINT "pipeline_stage_events_changed_by_fkey"
  FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill. Existing rows have no recorded history, so the honest reconstruction
-- is a single "joined at this stage" event dated when the deal was created.
-- Analytics will under-report movement for pre-existing deals until they move
-- again; that beats inventing transitions that never happened.
UPDATE "pipeline" SET "stage_changed_at" = "created_at";

INSERT INTO "pipeline_stage_events" ("id", "startup_id", "pipeline_id", "from_stage", "to_stage", "changed_by", "created_at")
SELECT
  gen_random_uuid()::text,
  "startup_id",
  "id",
  NULL,
  "stage",
  NULL,
  "created_at"
FROM "pipeline";
