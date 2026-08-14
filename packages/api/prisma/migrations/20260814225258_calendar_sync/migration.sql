-- AlterTable
ALTER TABLE "google_connections" ADD COLUMN     "calendar_sync_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "interaction_logs" ADD COLUMN     "edited_by_user" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateIndex
CREATE UNIQUE INDEX "interaction_logs_startup_investor_id_external_id_key" ON "interaction_logs"("startup_investor_id", "external_id");

