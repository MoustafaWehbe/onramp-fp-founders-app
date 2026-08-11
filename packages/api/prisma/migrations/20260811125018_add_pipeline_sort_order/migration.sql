-- AlterTable
ALTER TABLE "pipeline" ADD COLUMN     "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: give existing rows distinct positions within their stage, in the
-- order they were already effectively shown (oldest stage-move first), with
-- 1000-wide gaps so new inserts can slot between two rows without a rewrite.
UPDATE "pipeline" p
SET "sort_order" = ranked.rn * 1000
FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY stage ORDER BY stage_changed_at ASC, created_at ASC
  ) AS rn
  FROM "pipeline"
) ranked
WHERE p.id = ranked.id;
