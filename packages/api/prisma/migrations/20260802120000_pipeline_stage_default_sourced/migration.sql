-- Align Pipeline.stage with PIPELINE_STAGES / OpenAPI PipelineStage.
-- "prospect" was never a valid stage; default and any leftover rows become "sourced".

UPDATE "pipeline"
SET "stage" = 'sourced'
WHERE "stage" = 'prospect';

ALTER TABLE "pipeline" ALTER COLUMN "stage" SET DEFAULT 'sourced';
