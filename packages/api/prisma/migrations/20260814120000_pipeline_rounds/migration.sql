-- Pipelines are opportunities within a fundraising round, rather than a
-- startup-wide relationship. Existing rows cannot be assigned to an existing
-- round safely: a startup may have more than one historical round and the old
-- schema carried no such information. Preserve that history in one explicit,
-- non-active "Legacy pipeline" round per affected startup.

ALTER TABLE "pipeline" ADD COLUMN "round_id" TEXT;

-- It is impossible to make one opportunity round-specific without losing
-- information if historic data links that same pipeline row to multiple rounds
-- or different contacts. Fail before changing constraints so the affected
-- records can be repaired deliberately instead of choosing one arbitrarily.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "commitments"
    GROUP BY "pipeline_id"
    HAVING COUNT(DISTINCT "round_id") > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate pipeline rounds: a pipeline entry has commitments in multiple rounds';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "commitments" c
    JOIN "pipeline" p ON p."id" = c."pipeline_id"
    WHERE p."startup_investor_id" <> c."startup_investor_id"
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate pipeline rounds: a commitment investor does not match its pipeline entry';
  END IF;
END $$;

INSERT INTO "fundraising_rounds" (
  "id", "startup_id", "round_name", "currency", "status", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  legacy."startup_id",
  'Legacy pipeline',
  'USD',
  'legacy',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT p."startup_id"
  FROM "pipeline" p
) AS legacy;

UPDATE "pipeline" p
SET "round_id" = r."id"
FROM "fundraising_rounds" r
WHERE r."startup_id" = p."startup_id"
  AND r."round_name" = 'Legacy pipeline'
  AND r."status" = 'legacy';

-- When history already identifies a single round through a commitment, retain
-- that truth. Pipelines with no commitment remain in the explicit legacy
-- bucket because the pre-round schema cannot tell which raise they belonged to.
UPDATE "pipeline" p
SET "round_id" = committed."round_id"
FROM (
  SELECT "pipeline_id", MIN("round_id") AS "round_id"
  FROM "commitments"
  GROUP BY "pipeline_id"
) AS committed
WHERE p."id" = committed."pipeline_id";

ALTER TABLE "pipeline"
  ALTER COLUMN "round_id" SET NOT NULL;

-- The old key prevented the same contact appearing in a later round.
DROP INDEX "pipeline_startup_id_startup_investor_id_key";
CREATE UNIQUE INDEX "pipeline_round_id_startup_investor_id_key"
  ON "pipeline"("round_id", "startup_investor_id");

-- A commitment must name the exact pipeline opportunity for the same contact
-- and round. This replaces the weaker [pipeline_id, startup_id] relationship.
ALTER TABLE "commitments"
  DROP CONSTRAINT "commitments_pipeline_id_startup_id_fkey";

CREATE UNIQUE INDEX "pipeline_id_startup_investor_id_round_id_key"
  ON "pipeline"("id", "startup_investor_id", "round_id");

CREATE INDEX "pipeline_startup_id_round_id_stage_sort_order_idx"
  ON "pipeline"("startup_id", "round_id", "stage", "sort_order");
CREATE INDEX "pipeline_startup_id_round_id_stage_changed_at_idx"
  ON "pipeline"("startup_id", "round_id", "stage_changed_at");
CREATE INDEX "commitments_startup_id_round_id_status_idx"
  ON "commitments"("startup_id", "round_id", "status");

ALTER TABLE "pipeline"
  ADD CONSTRAINT "pipeline_round_id_startup_id_fkey"
  FOREIGN KEY ("round_id", "startup_id") REFERENCES "fundraising_rounds"("id", "startup_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commitments"
  ADD CONSTRAINT "commitments_pipeline_id_startup_investor_id_round_id_fkey"
  FOREIGN KEY ("pipeline_id", "startup_investor_id", "round_id")
  REFERENCES "pipeline"("id", "startup_investor_id", "round_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
