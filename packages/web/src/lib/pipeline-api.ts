import { apiClient } from "./api-client";
import type { PipelineStageId } from "./mock-data";
import type { Priority } from "./task-api";

export type PipelineContact = {
  id: string;
  startupId: string;
  fullName: string;
  email: string | null;
  ventureFirm: string | null;
  investorType: string | null;
  sectorFocus: string | null;
  investmentStagePreference: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PipelineEntry = {
  id: string;
  startupId: string;
  roundId: string;
  investorId: string;
  investor: PipelineContact;
  stage: PipelineStageId;
  expectedAmount: number | null;
  probabilityPercentage: number | null;
  /** StartupMember id who owns this deal, if assigned. */
  ownerId: string | null;
  priority: Priority | null;
  investorFitScore: number | null;
  /** Manual position within its stage's column, ascending. */
  sortOrder: number;
  /**
   * When the deal last moved stage. Distinct from updatedAt, which also moves
   * when the amount or probability is edited — so only this can measure how
   * long a deal has been sitting where it is.
   */
  stageChangedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type PipelineAnalytics = {
  totalDeals: number;
  funnel: {
    stage: PipelineStageId;
    current: number;
    currentValue: number;
    everReached: number;
    /** Median length of finished visits; null when nothing has left the stage. */
    medianDaysInStage: number | null;
  }[];
  conversion: {
    fromStage: PipelineStageId;
    toStage: PipelineStageId;
    reached: number;
    advanced: number;
    rate: number | null;
  }[];
  outcomes: {
    open: number;
    committed: number;
    passed: number;
    winRate: number | null;
  };
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export async function listPipelineEntries(
  startupId: string,
  params?: { page?: number; limit?: number; stage?: PipelineStageId; roundId?: string },
) {
  const { data } = await apiClient.get<{ data: PipelineEntry[]; meta: PaginationMeta }>(
    `/startups/${startupId}/pipeline`,
    { params },
  );
  return data;
}

export async function createPipelineEntry(
  startupId: string,
  body: {
    roundId?: string;
    investorId: string;
    stage: PipelineStageId;
    expectedAmount?: number;
    probabilityPercentage?: number;
    ownerId?: string;
    priority?: Priority;
    investorFitScore?: number;
  },
) {
  const { data } = await apiClient.post<{ data: PipelineEntry }>(
    `/startups/${startupId}/pipeline`,
    body,
  );
  return data.data;
}

export async function updatePipelineEntry(
  startupId: string,
  pipelineId: string,
  body: {
    stage?: PipelineStageId;
    expectedAmount?: number | null;
    probabilityPercentage?: number | null;
    sortOrder?: number;
    ownerId?: string | null;
    priority?: Priority | null;
    investorFitScore?: number | null;
    /** Required by the server when stage is being set to "passed". */
    reason?: string;
  },
) {
  const { data } = await apiClient.patch<{ data: PipelineEntry }>(
    `/startups/${startupId}/pipeline/${pipelineId}`,
    body,
  );
  return data.data;
}

/**
 * Funnel, conversion and stage velocity, computed server-side from the deal's
 * stage history rather than from the current board — a deal now marked passed
 * still counts toward every stage it once reached.
 */
export async function getPipelineAnalytics(startupId: string, roundId?: string) {
  const { data } = await apiClient.get<{ data: PipelineAnalytics }>(
    `/startups/${startupId}/pipeline/analytics`,
    { params: roundId ? { roundId } : undefined },
  );
  return data.data;
}

export async function deletePipelineEntry(startupId: string, pipelineId: string) {
  const { data } = await apiClient.delete<{ message: string }>(
    `/startups/${startupId}/pipeline/${pipelineId}`,
  );
  return data;
}

export type PipelineStageEvent = {
  id: string;
  /** Null for the first event — the deal being added to the pipeline. */
  fromStage: PipelineStageId | null;
  toStage: PipelineStageId;
  /** Only present when toStage is "passed". */
  reason: string | null;
  /** Null if the member who made this change has since been removed. */
  changedBy: string | null;
  createdAt: string;
};

/**
 * Why a deal needs attention, computed server-side: an overdue task, a task
 * due today, no open task at all, no interaction in 14+ days with nothing
 * scheduled, or a high-priority deal with no other signal.
 */
export type FocusReason = "overdue" | "today" | "missing" | "quiet" | "priority";

export type PipelineFocusEntry = PipelineEntry & {
  reason: FocusReason;
  daysQuiet: number;
  /** Due date of the soonest open task on this deal, if any. */
  nextTaskDueDate: string | null;
};

/**
 * Deals needing attention right now, pre-sorted by urgency. Computed
 * entirely server-side so the client never has to page through every
 * interaction log in the startup to build this list.
 */
export async function getPipelineFocus(startupId: string, roundId?: string) {
  const { data } = await apiClient.get<{ data: PipelineFocusEntry[] }>(
    `/startups/${startupId}/pipeline/focus`,
    { params: roundId ? { roundId } : undefined },
  );
  return data.data;
}

/** Who added this deal and who moved it since — oldest first. */
export async function listPipelineStageEvents(startupId: string, pipelineId: string) {
  const { data } = await apiClient.get<{ data: PipelineStageEvent[] }>(
    `/startups/${startupId}/pipeline/${pipelineId}/stage-events`,
  );
  return data.data;
}

