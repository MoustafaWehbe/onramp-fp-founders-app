import { apiClient } from "./api-client";

export const INTERACTION_TYPES = ["call", "email", "meeting", "note", "other"] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
  other: "Other",
};

export type InteractionLog = {
  id: string;
  investorId: string;
  pipelineId: string | null;
  /** User id of whoever logged it — resolve against the members list for a name. */
  createdBy: string;
  type: InteractionType;
  subject: string | null;
  description: string | null;
  interactionDate: string | null;
  nextFollowupDate: string | null;
  /**
   * Null while the follow-up is still outstanding. The API sets it when the
   * follow-up is marked done, and automatically when a later interaction is
   * logged for the same contact that satisfies it.
   */
  followupCompletedAt: string | null;
  createdAt: string;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type CreateInteractionLogInput = {
  investorId: string;
  /** Must belong to the same contact, or the API answers 422 PIPELINE_MISMATCH. */
  pipelineId?: string;
  type: InteractionType;
  interactionDate: string;
  subject?: string | null;
  description?: string | null;
};

// No follow-up fields: tasks superseded them, and the API no longer accepts a
// write to either. Old logs still return theirs for display.
export type UpdateInteractionLogInput = Partial<Omit<CreateInteractionLogInput, "investorId">>;

/** Newest first, across every contact in the startup. */
export async function listInteractionLogs(
  startupId: string,
  params: { page?: number; limit?: number } = {},
) {
  const { data } = await apiClient.get<{ data: InteractionLog[]; meta: PaginationMeta }>(
    `/startups/${startupId}/interaction-logs`,
    { params },
  );
  return data;
}

export async function listLogsForInvestor(
  startupId: string,
  investorId: string,
  params: { page?: number; limit?: number } = {},
) {
  const { data } = await apiClient.get<{ data: InteractionLog[]; meta: PaginationMeta }>(
    `/startups/${startupId}/investors/${investorId}/interaction-logs`,
    { params },
  );
  return data;
}

export async function createInteractionLog(
  startupId: string,
  input: CreateInteractionLogInput,
) {
  const { data } = await apiClient.post<{ data: InteractionLog }>(
    `/startups/${startupId}/interaction-logs`,
    input,
  );
  return data.data;
}

export async function updateInteractionLog(
  startupId: string,
  logId: string,
  input: UpdateInteractionLogInput,
) {
  const { data } = await apiClient.patch<{ data: InteractionLog }>(
    `/startups/${startupId}/interaction-logs/${logId}`,
    input,
  );
  return data.data;
}

export async function deleteInteractionLog(startupId: string, logId: string) {
  const { data } = await apiClient.delete<{ message: string }>(
    `/startups/${startupId}/interaction-logs/${logId}`,
  );
  return data;
}
