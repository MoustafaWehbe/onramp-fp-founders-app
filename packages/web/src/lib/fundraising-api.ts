import { apiClient } from "./api-client";
import type { PipelineContact, PaginationMeta } from "./pipeline-api";

export const ROUND_STATUSES = ["draft", "active", "closed", "cancelled"] as const;
export const COMMITMENT_STATUSES = [
  "pending",
  "negotiating",
  "confirmed",
  "funded",
  "withdrawn",
] as const;

export type RoundStatus = (typeof ROUND_STATUSES)[number];
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
  pending: "Pending",
  negotiating: "Negotiating",
  confirmed: "Confirmed",
  funded: "Funded",
  withdrawn: "Withdrawn",
};

export type FundraisingRound = {
  id: string;
  startupId: string;
  roundName: string;
  targetAmount: number | null;
  minimumTicketSize: number | null;
  equityOfferedPercentage: number | null;
  currency: string;
  status: RoundStatus;
  createdAt: string;
  updatedAt: string;
};

export type Commitment = {
  id: string;
  startupId: string;
  investorId: string;
  investor: PipelineContact;
  pipelineId: string;
  roundId: string;
  amount: number | null;
  status: CommitmentStatus;
  expectedCloseDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RoundInput = {
  roundName: string;
  targetAmount: number;
  minimumTicketSize?: number | null;
  equityOfferedPercentage?: number | null;
  currency: string;
  status?: RoundStatus;
};

export type CommitmentInput = {
  investorId: string;
  pipelineId: string;
  roundId: string;
  amount: number;
  status?: CommitmentStatus;
  expectedCloseDate?: string | null;
};

export async function listFundraisingRounds(startupId: string) {
  const { data } = await apiClient.get<{ data: FundraisingRound[]; meta: PaginationMeta }>(
    `/startups/${startupId}/fundraising-rounds`,
    { params: { limit: 100 } },
  );
  return data;
}

export async function createFundraisingRound(startupId: string, body: RoundInput) {
  const { data } = await apiClient.post<{ data: FundraisingRound }>(
    `/startups/${startupId}/fundraising-rounds`,
    body,
  );
  return data.data;
}

export async function updateFundraisingRound(
  startupId: string,
  roundId: string,
  body: Partial<RoundInput>,
) {
  const { data } = await apiClient.patch<{ data: FundraisingRound }>(
    `/startups/${startupId}/fundraising-rounds/${roundId}`,
    body,
  );
  return data.data;
}

export async function listCommitments(startupId: string, roundId?: string) {
  const path = roundId
    ? `/startups/${startupId}/fundraising-rounds/${roundId}/commitments`
    : `/startups/${startupId}/commitments`;
  const { data } = await apiClient.get<{ data: Commitment[]; meta: PaginationMeta }>(path, {
    params: { limit: 100 },
  });
  return data;
}

export async function createCommitment(startupId: string, body: CommitmentInput) {
  const { data } = await apiClient.post<{ data: Commitment }>(
    `/startups/${startupId}/commitments`,
    body,
  );
  return data.data;
}

export async function updateCommitment(
  startupId: string,
  commitmentId: string,
  body: Partial<Pick<CommitmentInput, "amount" | "status" | "expectedCloseDate">>,
) {
  const { data } = await apiClient.patch<{ data: Commitment }>(
    `/startups/${startupId}/commitments/${commitmentId}`,
    body,
  );
  return data.data;
}
