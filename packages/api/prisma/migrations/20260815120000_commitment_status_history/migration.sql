-- Commitment status history the funding chart needs to know when money
-- actually moved from soft-circled to hard-circled to wired, not just when
-- the commitment row was first created.

CREATE TABLE "commitment_status_events" (
    "id" TEXT NOT NULL,
    "startup_id" TEXT NOT NULL,
    "commitment_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commitment_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commitment_status_events_startup_id_created_at_idx"
  ON "commitment_status_events"("startup_id", "created_at");

CREATE INDEX "commitment_status_events_commitment_id_created_at_idx"
  ON "commitment_status_events"("commitment_id", "created_at");

ALTER TABLE "commitment_status_events" ADD CONSTRAINT "commitment_status_events_startup_id_fkey"
  FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "commitment_status_events" ADD CONSTRAINT "commitment_status_events_commitment_id_fkey"
  FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "commitment_status_events" ADD CONSTRAINT "commitment_status_events_changed_by_fkey"
  FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing commitments predate this table, so there is no real transition
-- moment to record for them. Backfilling one synthetic "recorded at creation"
-- event (fromStatus null, same as a fresh commitment) means every commitment
-- has at least one point in its history rather than none the funding chart
-- would otherwise show these as never having become bankable.
INSERT INTO "commitment_status_events" ("id", "startup_id", "commitment_id", "from_status", "to_status", "created_at")
SELECT gen_random_uuid(), "startup_id", "id", NULL, "status", "created_at"
FROM "commitments";
