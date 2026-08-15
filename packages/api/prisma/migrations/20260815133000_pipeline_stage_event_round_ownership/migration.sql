-- Stage history belongs to the round where the transition happened. Filtering
-- through pipeline.round_id reassigns every old event whenever a deal is
-- carried into a later raise.
ALTER TABLE "pipeline_stage_events" ADD COLUMN "round_id" TEXT;

-- Events created before this migration have no historical round reference.
-- Preserve the only recoverable truth: their deal's current round. Future
-- moves retain the original event ownership because every write now stamps it.
UPDATE "pipeline_stage_events" event
SET "round_id" = pipeline."round_id"
FROM "pipeline" pipeline
WHERE pipeline."id" = event."pipeline_id";

ALTER TABLE "pipeline_stage_events"
  ALTER COLUMN "round_id" SET NOT NULL;

CREATE INDEX "pipeline_stage_events_startup_id_round_id_created_at_idx"
  ON "pipeline_stage_events"("startup_id", "round_id", "created_at");

ALTER TABLE "pipeline_stage_events"
  ADD CONSTRAINT "pipeline_stage_events_round_id_startup_id_fkey"
  FOREIGN KEY ("round_id", "startup_id") REFERENCES "fundraising_rounds"("id", "startup_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
