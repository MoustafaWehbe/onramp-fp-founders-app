-- Phase 4: link controls (NDA gate, optional password, print policy,
-- email-domain allowlist at invite-creation time) plus the forwarding-
-- detection columns on reviewer_visits that Phase 3 deliberately deferred.

ALTER TABLE "reviewer_invitations"
  ADD COLUMN IF NOT EXISTS "allow_print" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "screenshot_guard" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "require_nda" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nda_text" TEXT,
  ADD COLUMN IF NOT EXISTS "nda_accepted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "password_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "allowed_email_domains" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "reviewer_visits"
  ADD COLUMN IF NOT EXISTS "device_type" TEXT,
  ADD COLUMN IF NOT EXISTS "os" TEXT,
  ADD COLUMN IF NOT EXISTS "browser" TEXT,
  ADD COLUMN IF NOT EXISTS "device_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "ip_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "referrer" TEXT,
  ADD COLUMN IF NOT EXISTS "suspected_forward" BOOLEAN NOT NULL DEFAULT false;
