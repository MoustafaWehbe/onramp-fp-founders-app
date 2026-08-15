-- AlterTable
ALTER TABLE "reviewer_sessions" ADD COLUMN IF NOT EXISTS "session_token_hash" TEXT;
ALTER TABLE "reviewer_sessions" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);
ALTER TABLE "reviewer_sessions" ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMP(3);
ALTER TABLE "reviewer_sessions" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "reviewer_sessions_session_token_hash_key"
  ON "reviewer_sessions"("session_token_hash");

CREATE INDEX IF NOT EXISTS "reviewer_sessions_invitation_id_idx"
  ON "reviewer_sessions"("invitation_id");
