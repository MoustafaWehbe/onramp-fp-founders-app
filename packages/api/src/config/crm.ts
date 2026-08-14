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

export const TASK_STATUSES = ["open", "completed"] as const;

/** Shared by Task.priority (task urgency) and Pipeline.priority (deal importance). */
export const PRIORITIES = ["low", "medium", "high"] as const;

export type InvestorType = (typeof INVESTOR_TYPES)[number];
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
