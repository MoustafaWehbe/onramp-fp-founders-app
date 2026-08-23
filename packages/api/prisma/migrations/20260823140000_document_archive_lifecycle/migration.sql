ALTER TABLE "documents"
ADD COLUMN "archived_at" TIMESTAMP(3);

CREATE INDEX "documents_startup_id_archived_at_updated_at_idx"
ON "documents"("startup_id", "archived_at", "updated_at");
