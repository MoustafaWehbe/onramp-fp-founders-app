-- AlterTable
ALTER TABLE "startup_investors" ADD COLUMN     "notes_created_at" TIMESTAMP(3),
ADD COLUMN     "notes_created_by" TEXT,
ADD COLUMN     "notes_updated_at" TIMESTAMP(3),
ADD COLUMN     "notes_updated_by" TEXT;

-- Notes written before this migration have no recorded author. Stamping the
-- contact's own updated_at as the edit time is the closest truth available and
-- keeps "last edited" from reading as never-touched.
UPDATE "startup_investors"
SET "notes_created_at" = "updated_at", "notes_updated_at" = "updated_at"
WHERE "notes" IS NOT NULL AND "notes" <> '';

-- AddForeignKey
ALTER TABLE "startup_investors" ADD CONSTRAINT "startup_investors_notes_created_by_fkey" FOREIGN KEY ("notes_created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "startup_investors" ADD CONSTRAINT "startup_investors_notes_updated_by_fkey" FOREIGN KEY ("notes_updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
