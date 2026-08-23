ALTER TABLE "reviewer_comments"
ADD COLUMN "document_version_id" TEXT;

UPDATE "reviewer_comments" AS comment
SET "document_version_id" = chunk."document_version_id"
FROM "document_chunks" AS chunk
WHERE comment."chunk_id" = chunk."id";

WITH latest_pinned AS (
  SELECT DISTINCT ON ("invitation_id", "document_id")
    "invitation_id",
    "document_id",
    "document_version_id"
  FROM "reviewer_invitation_documents"
  ORDER BY "invitation_id", "document_id", "added_at" DESC
)
UPDATE "reviewer_comments" AS comment
SET "document_version_id" = pinned."document_version_id"
FROM latest_pinned AS pinned
WHERE comment."document_version_id" IS NULL
  AND comment."document_id" IS NOT NULL
  AND pinned."invitation_id" = comment."invitation_id"
  AND pinned."document_id" = comment."document_id";

ALTER TABLE "reviewer_comments"
ADD CONSTRAINT "reviewer_comments_document_version_id_fkey"
FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "reviewer_comments_document_version_id_created_at_idx"
ON "reviewer_comments"("document_version_id", "created_at");
