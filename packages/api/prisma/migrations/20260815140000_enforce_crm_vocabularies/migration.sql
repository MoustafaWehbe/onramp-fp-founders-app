-- The API validates these vocabularies, and these checks extend that protection
-- to imports, scripts, and direct database writes. NOT VALID preserves any
-- legacy rows while enforcing the allowed values for all future writes.
ALTER TABLE "pipeline"
  ADD CONSTRAINT "pipeline_stage_check"
  CHECK ("stage" IN ('sourced', 'contacted', 'meeting_scheduled', 'due_diligence', 'term_sheet', 'committed', 'passed')) NOT VALID;

ALTER TABLE "pipeline_stage_events"
  ADD CONSTRAINT "pipeline_stage_events_to_stage_check"
  CHECK ("to_stage" IN ('sourced', 'contacted', 'meeting_scheduled', 'due_diligence', 'term_sheet', 'committed', 'passed')) NOT VALID,
  ADD CONSTRAINT "pipeline_stage_events_from_stage_check"
  CHECK ("from_stage" IS NULL OR "from_stage" IN ('sourced', 'contacted', 'meeting_scheduled', 'due_diligence', 'term_sheet', 'committed', 'passed')) NOT VALID;

ALTER TABLE "commitments"
  ADD CONSTRAINT "commitments_status_check"
  CHECK ("status" IN ('soft_circled', 'hard_circled', 'wired', 'withdrawn')) NOT VALID;

ALTER TABLE "commitment_status_events"
  ADD CONSTRAINT "commitment_status_events_to_status_check"
  CHECK ("to_status" IN ('soft_circled', 'hard_circled', 'wired', 'withdrawn')) NOT VALID,
  ADD CONSTRAINT "commitment_status_events_from_status_check"
  CHECK ("from_status" IS NULL OR "from_status" IN ('soft_circled', 'hard_circled', 'wired', 'withdrawn')) NOT VALID;

-- Legacy pipeline rounds are created by the historical round migration, so
-- retain that one supported archival value alongside current product states.
ALTER TABLE "fundraising_rounds"
  ADD CONSTRAINT "fundraising_rounds_status_check"
  CHECK ("status" IN ('draft', 'active', 'closed', 'cancelled', 'legacy')) NOT VALID;
