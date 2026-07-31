export const INVESTOR_TYPES = ["vc", "angel", "family_office", "accelerator", "other"] as const;

export const PIPELINE_STAGES = [
  "sourced",
  "contacted",
  "meeting_scheduled",
  "due_diligence",
  "term_sheet",
  "committed",
  "passed",
] as const;

export type InvestorType = (typeof INVESTOR_TYPES)[number];
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
