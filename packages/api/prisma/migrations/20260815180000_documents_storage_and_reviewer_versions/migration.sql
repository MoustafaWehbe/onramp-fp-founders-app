-- Document versions: private storage metadata + processing lifecycle
ALTER TABLE "document_versions" ALTER COLUMN "file_url" DROP NOT NULL;

ALTER TABLE "document_versions"
  ADD COLUMN IF NOT EXISTS "storage_provider" TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS "storage_key" TEXT,
  ADD COLUMN IF NOT EXISTS "mime_type" TEXT,
  ADD COLUMN IF NOT EXISTS "original_filename" TEXT,
  ADD COLUMN IF NOT EXISTS "checksum_sha256" TEXT,
  ADD COLUMN IF NOT EXISTS "processing_status" TEXT NOT NULL DEFAULT 'pending_upload',
  ADD COLUMN IF NOT EXISTS "processing_error" TEXT;

UPDATE "document_versions"
SET
  "storage_key" = COALESCE("storage_key", "file_url", "id"::text),
  "mime_type" = COALESCE("mime_type", 'application/octet-stream'),
  "original_filename" = COALESCE("original_filename", 'document.bin'),
  "processing_status" = CASE
    WHEN "file_url" IS NOT NULL THEN 'ready'
    ELSE "processing_status"
  END
WHERE "storage_key" IS NULL OR "mime_type" IS NULL OR "original_filename" IS NULL;

ALTER TABLE "document_versions" ALTER COLUMN "storage_key" SET NOT NULL;
ALTER TABLE "document_versions" ALTER COLUMN "mime_type" SET NOT NULL;
ALTER TABLE "document_versions" ALTER COLUMN "original_filename" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "document_versions_document_id_id_key"
  ON "document_versions"("document_id", "id");

ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "char_start" INTEGER,
  ADD COLUMN IF NOT EXISTS "char_end" INTEGER;

-- Reviewer invitations: normalized email + richer access fields
ALTER TABLE "reviewer_invitations" RENAME COLUMN "email" TO "email_normalized";

ALTER TABLE "reviewer_invitations"
  ADD COLUMN IF NOT EXISTS "allow_download" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "personal_message" TEXT,
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_activity_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "reviewer_invitations" SET "email_normalized" = lower("email_normalized");

CREATE INDEX IF NOT EXISTS "reviewer_invitations_startup_id_status_idx"
  ON "reviewer_invitations"("startup_id", "status");
CREATE INDEX IF NOT EXISTS "reviewer_invitations_startup_id_email_normalized_idx"
  ON "reviewer_invitations"("startup_id", "email_normalized");
CREATE INDEX IF NOT EXISTS "reviewer_invitations_startup_id_expires_at_idx"
  ON "reviewer_invitations"("startup_id", "expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "reviewer_invitations_startup_id_id_key"
  ON "reviewer_invitations"("startup_id", "id");

-- Pin invitation shares to immutable document versions
ALTER TABLE "reviewer_invitation_documents"
  ADD COLUMN IF NOT EXISTS "document_version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "display_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "added_by" TEXT;

-- Clear draft invitation shares that cannot be version-pinned safely
DELETE FROM "reviewer_invitation_documents";

ALTER TABLE "reviewer_invitation_documents" DROP CONSTRAINT IF EXISTS "reviewer_invitation_documents_invitation_id_document_id_key";
ALTER TABLE "reviewer_invitation_documents" ALTER COLUMN "document_version_id" SET NOT NULL;
ALTER TABLE "reviewer_invitation_documents" ALTER COLUMN "added_by" SET NOT NULL;

ALTER TABLE "reviewer_invitation_documents"
  ADD CONSTRAINT "reviewer_invitation_documents_document_version_id_fkey"
  FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "reviewer_invitation_documents_invitation_id_document_version_id_key"
  ON "reviewer_invitation_documents"("invitation_id", "document_version_id");
