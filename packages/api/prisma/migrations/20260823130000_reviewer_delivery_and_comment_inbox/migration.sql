ALTER TABLE "reviewer_invitations"
  ADD COLUMN "delivery_status" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "delivery_generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "delivery_last_attempt_at" TIMESTAMP(3),
  ADD COLUMN "delivery_sent_at" TIMESTAMP(3),
  ADD COLUMN "delivery_failed_at" TIMESTAMP(3),
  ADD COLUMN "delivery_error" TEXT,
  ADD COLUMN "delivery_message_id" TEXT;

ALTER TABLE "reviewer_comments"
  ADD COLUMN "invitation_id" TEXT,
  ADD COLUMN "read_at" TIMESTAMP(3),
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "resolved_by" TEXT;

UPDATE "reviewer_comments" AS comment
SET "invitation_id" = session."invitation_id"
FROM "reviewer_sessions" AS session
WHERE comment."session_id" = session."id";

ALTER TABLE "reviewer_comments"
  ALTER COLUMN "invitation_id" SET NOT NULL;

ALTER TABLE "reviewer_comments"
  ADD CONSTRAINT "reviewer_comments_invitation_id_fkey"
    FOREIGN KEY ("invitation_id") REFERENCES "reviewer_invitations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "reviewer_comments_resolved_by_fkey"
    FOREIGN KEY ("resolved_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "reviewer_comments_startup_id_resolved_at_created_at_idx"
  ON "reviewer_comments"("startup_id", "resolved_at", "created_at");

CREATE INDEX "reviewer_comments_invitation_id_created_at_idx"
  ON "reviewer_comments"("invitation_id", "created_at");
