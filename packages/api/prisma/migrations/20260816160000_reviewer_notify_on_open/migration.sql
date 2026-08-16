-- notifyOnOpen: per-invitation toggle for the "reviewer is reading right now"
-- notification. Default true, same shape as watermark_enabled from Phase 2.

ALTER TABLE "reviewer_invitations"
  ADD COLUMN IF NOT EXISTS "notify_on_open" BOOLEAN NOT NULL DEFAULT true;
