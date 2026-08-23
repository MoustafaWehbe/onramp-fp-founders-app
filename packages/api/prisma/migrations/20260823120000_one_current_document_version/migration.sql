-- A document must never expose two current versions, even when independent
-- processing/rasterization workers finish at the same time.
CREATE UNIQUE INDEX "document_versions_one_current_per_document"
  ON "document_versions" ("document_id")
  WHERE "is_current" = true;
