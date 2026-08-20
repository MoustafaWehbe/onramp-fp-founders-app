ALTER TABLE "ai_runs"
  ADD COLUMN "time_to_first_token_ms" INTEGER,
  ADD COLUMN "retrieval_result_count" INTEGER,
  ADD COLUMN "retrieval_min_score" DOUBLE PRECISION,
  ADD COLUMN "retrieval_max_score" DOUBLE PRECISION;
