-- Postgres has no native "exactly one of N nullable FKs" primitive, so
-- application-level typed-FK-per-target-type schemas like this one need the
-- invariant written by hand. Two constraints together enforce it: exactly one
-- of the six target columns is non-null, and target_type names the right one
-- — the same NOT VALID pattern as 20260815140000_enforce_crm_vocabularies.

ALTER TABLE "message_mentions"
  ADD CONSTRAINT "message_mentions_target_type_check"
  CHECK ("target_type" IN ('member', 'investor', 'deal', 'task', 'round', 'document')) NOT VALID;

ALTER TABLE "message_mentions"
  ADD CONSTRAINT "message_mentions_exactly_one_target_check"
  CHECK (
    (CASE WHEN "mentioned_member_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "investor_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "pipeline_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "task_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "round_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "document_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
  ) NOT VALID;

ALTER TABLE "message_mentions"
  ADD CONSTRAINT "message_mentions_target_type_matches_check"
  CHECK (
    ("target_type" = 'member' AND "mentioned_member_id" IS NOT NULL) OR
    ("target_type" = 'investor' AND "investor_id" IS NOT NULL) OR
    ("target_type" = 'deal' AND "pipeline_id" IS NOT NULL) OR
    ("target_type" = 'task' AND "task_id" IS NOT NULL) OR
    ("target_type" = 'round' AND "round_id" IS NOT NULL) OR
    ("target_type" = 'document' AND "document_id" IS NOT NULL)
  ) NOT VALID;
