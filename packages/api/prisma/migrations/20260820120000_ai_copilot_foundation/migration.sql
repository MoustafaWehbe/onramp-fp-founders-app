-- Unified AI copilot foundation. The legacy AI tables were placeholders, but
-- the backfill below preserves any development data that may already exist.

ALTER TABLE "ai_chat_sessions"
  DROP CONSTRAINT IF EXISTS "ai_chat_sessions_analysis_id_startup_id_fkey",
  DROP CONSTRAINT IF EXISTS "ai_chat_sessions_document_id_startup_id_fkey";

ALTER TABLE "ai_analyses"
  ADD COLUMN "analysis_type" TEXT NOT NULL DEFAULT 'pitch_deck',
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "confidence_score" INTEGER,
  ADD COLUMN "error_code" TEXT,
  ADD COLUMN "error_message" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "requested_by" TEXT,
  ADD COLUMN "result" JSONB,
  ADD COLUMN "rubric_version" TEXT NOT NULL DEFAULT 'pitch-deck.v1',
  ADD COLUMN "schema_version" TEXT NOT NULL DEFAULT 'pitch-deck.v1',
  ADD COLUMN "session_id" TEXT,
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "status" SET DEFAULT 'queued';

-- Analyses predate a requester field. The startup creator is the only safe
-- attributable fallback; new records always set the actual requesting user.
UPDATE "ai_analyses" AS analysis
SET "requested_by" = startup."created_by"
FROM "startups" AS startup
WHERE analysis."startup_id" = startup."id"
  AND analysis."requested_by" IS NULL;

ALTER TABLE "ai_analyses"
  ALTER COLUMN "requested_by" SET NOT NULL,
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "ai_chat_messages"
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "error_code" TEXT,
  ADD COLUMN "error_message" TEXT,
  ADD COLUMN "input_tokens" INTEGER,
  ADD COLUMN "latency_ms" INTEGER,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "output_tokens" INTEGER,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN "structured_content" JSONB;

ALTER TABLE "ai_chat_sessions"
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "context_mode" TEXT NOT NULL DEFAULT 'selected',
  ADD COLUMN "last_message_at" TIMESTAMP(3),
  ADD COLUMN "round_id" TEXT,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Preserve legacy single-document and single-analysis references before those
-- columns are removed. A session pins the document's current version.
CREATE TABLE "ai_chat_session_documents" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "document_version_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_chat_session_documents_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ai_chat_session_documents" ("id", "session_id", "document_id", "document_version_id", "created_at")
SELECT gen_random_uuid(), session."id", session."document_id", version."id", session."created_at"
FROM "ai_chat_sessions" AS session
JOIN "document_versions" AS version
  ON version."document_id" = session."document_id"
  AND version."is_current" = true
WHERE session."document_id" IS NOT NULL;

UPDATE "ai_analyses" AS analysis
SET "session_id" = session."id"
FROM "ai_chat_sessions" AS session
WHERE session."analysis_id" = analysis."id"
  AND analysis."session_id" IS NULL;

ALTER TABLE "ai_chat_sessions"
  DROP COLUMN "analysis_id",
  DROP COLUMN "document_id",
  ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE TABLE "ai_citations" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "document_chunk_id" TEXT,
  "label" TEXT NOT NULL,
  "excerpt" TEXT,
  "metadata" JSONB,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_citations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_tool_calls" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "tool_name" TEXT NOT NULL,
  "arguments" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "duration_ms" INTEGER,
  "error_code" TEXT,
  "result_summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_tool_calls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_runs" (
  "id" TEXT NOT NULL,
  "startup_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "session_id" TEXT,
  "message_id" TEXT,
  "analysis_id" TEXT,
  "operation_type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "provider_request_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'started',
  "input_tokens" INTEGER,
  "cached_input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "latency_ms" INTEGER,
  "estimated_cost_micros" BIGINT,
  "error_code" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_analysis_evidence" (
  "id" TEXT NOT NULL,
  "analysis_id" TEXT NOT NULL,
  "gap_analysis_id" TEXT,
  "document_chunk_id" TEXT NOT NULL,
  "evidence_type" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "excerpt" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_analysis_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_artifacts" (
  "id" TEXT NOT NULL,
  "startup_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "analysis_id" TEXT,
  "artifact_type" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "title" TEXT,
  "status" TEXT NOT NULL DEFAULT 'building',
  "data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_artifacts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ai_artifacts" ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE UNIQUE INDEX "ai_chat_session_documents_session_id_document_version_id_key"
  ON "ai_chat_session_documents"("session_id", "document_version_id");
CREATE INDEX "ai_chat_session_documents_document_id_idx" ON "ai_chat_session_documents"("document_id");
CREATE INDEX "ai_citations_message_id_sort_order_idx" ON "ai_citations"("message_id", "sort_order");
CREATE INDEX "ai_tool_calls_message_id_created_at_idx" ON "ai_tool_calls"("message_id", "created_at");
CREATE INDEX "ai_runs_startup_id_created_at_idx" ON "ai_runs"("startup_id", "created_at");
CREATE INDEX "ai_runs_user_id_created_at_idx" ON "ai_runs"("user_id", "created_at");
CREATE INDEX "ai_runs_session_id_created_at_idx" ON "ai_runs"("session_id", "created_at");
CREATE INDEX "ai_runs_analysis_id_created_at_idx" ON "ai_runs"("analysis_id", "created_at");
CREATE INDEX "ai_runs_status_created_at_idx" ON "ai_runs"("status", "created_at");
CREATE INDEX "ai_analysis_evidence_analysis_id_sort_order_idx" ON "ai_analysis_evidence"("analysis_id", "sort_order");
CREATE INDEX "ai_analysis_evidence_document_chunk_id_idx" ON "ai_analysis_evidence"("document_chunk_id");
CREATE INDEX "ai_artifacts_startup_id_session_id_created_at_idx" ON "ai_artifacts"("startup_id", "session_id", "created_at");
CREATE INDEX "ai_artifacts_message_id_created_at_idx" ON "ai_artifacts"("message_id", "created_at");
CREATE INDEX "ai_artifacts_analysis_id_created_at_idx" ON "ai_artifacts"("analysis_id", "created_at");
CREATE INDEX "ai_analyses_startup_id_document_version_id_created_at_idx" ON "ai_analyses"("startup_id", "document_version_id", "created_at");
CREATE INDEX "ai_analyses_startup_id_session_id_created_at_idx" ON "ai_analyses"("startup_id", "session_id", "created_at");
CREATE INDEX "ai_analyses_startup_id_status_created_at_idx" ON "ai_analyses"("startup_id", "status", "created_at");
CREATE INDEX "ai_chat_messages_session_id_created_at_idx" ON "ai_chat_messages"("session_id", "created_at");
CREATE INDEX "ai_chat_sessions_startup_id_user_id_archived_at_last_messag_idx"
  ON "ai_chat_sessions"("startup_id", "user_id", "archived_at", "last_message_at");
CREATE UNIQUE INDEX "ai_chat_sessions_startup_id_id_key" ON "ai_chat_sessions"("startup_id", "id");

-- pgvector is already enabled by the datasource. This performance index never
-- replaces the startup/document-version filter in retrieval queries.
CREATE INDEX "document_chunks_embedding_hnsw_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE "ai_analyses"
  ADD CONSTRAINT "ai_analyses_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "ai_chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_analyses_requested_by_fkey"
    FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_chat_sessions"
  ADD CONSTRAINT "ai_chat_sessions_round_id_startup_id_fkey"
    FOREIGN KEY ("round_id", "startup_id") REFERENCES "fundraising_rounds"("id", "startup_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_chat_session_documents"
  ADD CONSTRAINT "ai_chat_session_documents_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "ai_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_chat_session_documents_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_chat_session_documents_document_version_id_fkey"
    FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_citations"
  ADD CONSTRAINT "ai_citations_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "ai_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_tool_calls"
  ADD CONSTRAINT "ai_tool_calls_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "ai_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_runs"
  ADD CONSTRAINT "ai_runs_startup_id_fkey"
    FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_runs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_runs_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "ai_chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_runs_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "ai_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_runs_analysis_id_fkey"
    FOREIGN KEY ("analysis_id") REFERENCES "ai_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_analysis_evidence"
  ADD CONSTRAINT "ai_analysis_evidence_analysis_id_fkey"
    FOREIGN KEY ("analysis_id") REFERENCES "ai_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_analysis_evidence_gap_analysis_id_fkey"
    FOREIGN KEY ("gap_analysis_id") REFERENCES "ai_gap_analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_analysis_evidence_document_chunk_id_fkey"
    FOREIGN KEY ("document_chunk_id") REFERENCES "document_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_artifacts"
  ADD CONSTRAINT "ai_artifacts_startup_id_fkey"
    FOREIGN KEY ("startup_id") REFERENCES "startups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_artifacts_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "ai_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_artifacts_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "ai_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_artifacts_analysis_id_fkey"
    FOREIGN KEY ("analysis_id") REFERENCES "ai_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
