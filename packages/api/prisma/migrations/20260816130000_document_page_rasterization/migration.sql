-- Page-image rasterization for the reviewer portal.
--
-- Reviewers are served rendered page images, never the source object. Render
-- state is tracked separately from `processing_status` (text extraction) so a
-- large deck rasterizing does not hold back AI/search, and vice versa.

ALTER TABLE "document_versions"
  ADD COLUMN IF NOT EXISTS "render_status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "render_error" TEXT,
  ADD COLUMN IF NOT EXISTS "page_count" INTEGER;

-- Versions that predate this migration have no page images. Mark non-PDFs
-- 'unsupported' so the share path can reject them without a render attempt;
-- leave PDFs 'pending' so a backfill can pick them up.
UPDATE "document_versions"
SET "render_status" = 'unsupported'
WHERE "mime_type" <> 'application/pdf';

CREATE TABLE IF NOT EXISTS "document_pages" (
  "id"                  TEXT NOT NULL,
  "document_version_id" TEXT NOT NULL,
  "page_number"         INTEGER NOT NULL,
  "width"               INTEGER NOT NULL,
  "height"              INTEGER NOT NULL,
  "storage_key"         TEXT NOT NULL,
  "thumb_storage_key"   TEXT NOT NULL,
  "storage_provider"    TEXT NOT NULL DEFAULT 'local',
  "byte_size"           INTEGER,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_pages_document_version_id_page_number_key"
  ON "document_pages"("document_version_id", "page_number");

ALTER TABLE "document_pages"
  DROP CONSTRAINT IF EXISTS "document_pages_document_version_id_fkey";

ALTER TABLE "document_pages"
  ADD CONSTRAINT "document_pages_document_version_id_fkey"
  FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
