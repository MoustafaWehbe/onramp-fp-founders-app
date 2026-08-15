-- Commitment statuses move to the vocabulary founders and investors actually
-- use, so the totals cannot be read two ways:
--
--   pending, negotiating -> soft_circled  (verbal; never counts as raised)
--   confirmed            -> hard_circled  (docs signed; legally committed)
--   funded               -> wired         (money in the bank)
--   withdrawn            -> withdrawn     (unchanged)
--
-- Both old "soft" states collapse into one because the distinction between
-- them was never load-bearing: neither was bankable, and neither counted
-- toward the target. The rename is applied to the data before the default
-- changes, so no row is left holding a value the application no longer knows.

UPDATE "commitments"
SET "status" = CASE "status"
  WHEN 'pending'     THEN 'soft_circled'
  WHEN 'negotiating' THEN 'soft_circled'
  WHEN 'confirmed'   THEN 'hard_circled'
  WHEN 'funded'      THEN 'wired'
  ELSE "status"
END
WHERE "status" IN ('pending', 'negotiating', 'confirmed', 'funded');

-- Guard: refuse to finish if anything is left outside the new vocabulary,
-- rather than silently leaving rows the app cannot render.
DO $$
DECLARE stray_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO stray_count
  FROM "commitments"
  WHERE "status" NOT IN ('soft_circled', 'hard_circled', 'wired', 'withdrawn');

  IF stray_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate commitment statuses: % row(s) hold an unrecognised status', stray_count;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "commitments" ALTER COLUMN "status" SET DEFAULT 'soft_circled';

-- AlterTable
ALTER TABLE "fundraising_rounds" ADD COLUMN     "first_close_date" TIMESTAMP(3),
ADD COLUMN     "target_close_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pipeline" ADD COLUMN     "is_lead" BOOLEAN NOT NULL DEFAULT false;
