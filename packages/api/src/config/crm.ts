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

export const ROUND_STATUSES = ["draft", "active", "closed", "cancelled"] as const;

/** Rounds that can still take new outreach. A raise that is closed or
 *  cancelled must not quietly accept new deals. */
export const OPEN_ROUND_STATUSES = ["draft", "active"] as const;

export const COMMITMENT_STATUSES = [
  "pending",
  "negotiating",
  "confirmed",
  "funded",
  "withdrawn",
] as const;

export const TASK_STATUSES = ["open", "completed"] as const;

/** Shared by Task.priority (task urgency) and Pipeline.priority (deal importance). */
export const PRIORITIES = ["low", "medium", "high"] as const;

export type InvestorType = (typeof INVESTOR_TYPES)[number];
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type RoundStatus = (typeof ROUND_STATUSES)[number];
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
