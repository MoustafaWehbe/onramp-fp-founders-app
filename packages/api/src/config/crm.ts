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

export const INITIAL_PIPELINE_STAGES = [
  "sourced",
  "contacted",
  "meeting_scheduled",
  "due_diligence",
  "term_sheet",
] as const;

export const ROUND_STATUSES = ["draft", "active", "closed", "cancelled"] as const;

/** Rounds that can still take new outreach. A raise that is closed or
 *  cancelled must not quietly accept new deals. */
export const OPEN_ROUND_STATUSES = ["draft", "active"] as const;

/**
 * The vocabulary founders and investors actually use for a raise.
 *
 * "Soft-circled" is a verbal yes with nothing signed it evaporates often
 * enough that it must never be counted as raised. "Hard-circled" means the
 * docs are signed and the money is legally committed. "Wired" means it is in
 * the bank. Naming the states after what they legally mean is what keeps the
 * totals honest; vaguer words ("confirmed") invite a verbal maybe to be filed
 * as money in hand.
 */
export const COMMITMENT_STATUSES = [
  "soft_circled",
  "hard_circled",
  "wired",
  "withdrawn",
] as const;

/** Signed or better the money a founder may legitimately call raised. */
export const BANKABLE_COMMITMENT_STATUSES = ["hard_circled", "wired"] as const;

export const TASK_STATUSES = ["open", "completed"] as const;

/** Shared by Task.priority (task urgency) and Pipeline.priority (deal importance). */
export const PRIORITIES = ["low", "medium", "high"] as const;

export type InvestorType = (typeof INVESTOR_TYPES)[number];
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type InitialPipelineStage = (typeof INITIAL_PIPELINE_STAGES)[number];
export type RoundStatus = (typeof ROUND_STATUSES)[number];
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
