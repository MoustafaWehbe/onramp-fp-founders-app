-- Investor contacts become private per-startup records.
--
-- `investors` was a single global row deduped by unique email, joined to
-- startups through `startup_investors`. Two startups adding the same person
-- shared one row, so either could edit the other's CRM data. The contact
-- fields move onto `startup_investors` and the global table is dropped.
--
-- Written by hand rather than auto-diffed so existing rows are backfilled
-- from `investors` instead of dropped.

-- 1. Add the contact columns, nullable for now so the backfill can run.
ALTER TABLE "startup_investors" ADD COLUMN "full_name" TEXT;
ALTER TABLE "startup_investors" ADD COLUMN "email" TEXT;
ALTER TABLE "startup_investors" ADD COLUMN "venture_firm" TEXT;
ALTER TABLE "startup_investors" ADD COLUMN "investor_type" TEXT;
ALTER TABLE "startup_investors" ADD COLUMN "sector_focus" TEXT;
ALTER TABLE "startup_investors" ADD COLUMN "investment_stage_preference" TEXT;
ALTER TABLE "startup_investors" ADD COLUMN "linkedin_url" TEXT;

-- 2. Copy each link's data down from the shared investor row.
UPDATE "startup_investors" si
SET
  "full_name"                   = i."full_name",
  "email"                       = i."email",
  "venture_firm"                = i."venture_firm",
  "sector_focus"                = i."sector_focus",
  "investment_stage_preference" = i."investment_stage_preference",
  "linkedin_url"                = i."linkedin_url"
FROM "investors" i
WHERE si."investor_id" = i."id";

-- 3. Backstop for any orphaned link the join above missed, so the NOT NULL
--    below cannot fail. `investor_id` was NOT NULL with an FK, so this should
--    affect zero rows in practice.
UPDATE "startup_investors"
SET "full_name" = 'Unknown contact'
WHERE "full_name" IS NULL;

-- 4. full_name is the one required contact field.
ALTER TABLE "startup_investors" ALTER COLUMN "full_name" SET NOT NULL;

-- 5. Drop the link to the global table.
ALTER TABLE "startup_investors" DROP CONSTRAINT "startup_investors_investor_id_fkey";
DROP INDEX "startup_investors_startup_id_investor_id_key";
ALTER TABLE "startup_investors" DROP COLUMN "investor_id";

-- 6. Dedupe on email within a startup instead of globally. NULL emails do not
--    collide in Postgres, so contacts without an address coexist freely.
CREATE UNIQUE INDEX "startup_investors_startup_id_email_key" ON "startup_investors"("startup_id", "email");

-- 7. The global table has no remaining references.
DROP TABLE "investors";
