-- Prisma reads message-level telemetry when loading an AI conversation.
-- Keep this separate from the earlier ai_runs telemetry migration so databases
-- that already applied it can safely receive the missing columns.
ALTER TABLE "ai_chat_messages"
  ADD COLUMN "time_to_first_token_ms" INTEGER,
  ADD COLUMN "retrieval_result_count" INTEGER,
  ADD COLUMN "retrieval_min_score" DOUBLE PRECISION,
  ADD COLUMN "retrieval_max_score" DOUBLE PRECISION;
