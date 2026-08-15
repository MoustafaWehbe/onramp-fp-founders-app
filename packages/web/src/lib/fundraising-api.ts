import { apiClient } from "./api-client";
import type { PipelineContact, PaginationMeta } from "./pipeline-api";

export const ROUND_STATUSES = ["draft", "active", "closed", "cancelled"] as const;
/**
 * The vocabulary founders and investors use. Soft-circled is a verbal yes
 * with nothing signed and never counts as raised; hard-circled means the docs
 * are signed; wired means the money is in the bank.
 */
export const COMMITMENT_STATUSES = [
  "soft_circled",
  "hard_circled",
  "wired",
  "withdrawn",
] as const;

/** Rounds that can still take pipeline deals; the API enforces the same set. */
export const OPEN_ROUND_STATUSES: readonly string[] = ["draft", "active"];

export type RoundStatus = (typeof ROUND_STATUSES)[number];
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
  soft_circled: "Soft-circled",
  hard_circled: "Hard-circled",
  wired: "Wired",
  withdrawn: "Withdrawn",
};

/** Shown next to the choice, so the distinction is made at the point of entry. */
export const COMMITMENT_STATUS_HINTS: Record<CommitmentStatus, string> = {
  soft_circled: "Verbal only not counted toward the target",
  hard_circled: "Docs signed counts toward the target",
  wired: "Money received",
  withdrawn: "Backed out",
};

/** Signed or better the money you may legitimately call raised. */
export function isBankable(status: CommitmentStatus): boolean {
  return status === "hard_circled" || status === "wired";
}

export type FundraisingRound = {
  id: string;
  startupId: string;
  roundName: string;
  targetAmount: number | null;
  minimumTicketSize: number | null;
  equityOfferedPercentage: number | null;
  currency: string;
  status: RoundStatus;
  /** Rolling closes: money in the door here, the rest by targetCloseDate. */
  firstCloseDate: string | null;
  targetCloseDate: string | null;
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
  firstCloseDate?: string | null;
  targetCloseDate?: string | null;
};

export type CommitmentInput = {
  investorId: string;
  pipelineId: string;
  roundId: string;
  amount: number;
  status?: CommitmentStatus;
  expectedCloseDate?: string | null;
};

/**
 * The numbers a round's health is judged by, computed server-side so
 * Dashboard, Fundraising and anywhere else showing "this round's numbers"
 * read the same values. Every amount is in `currency`, never assumed USD.
 */
export type RoundMetrics = {
  currency: string;
  targetAmount: number;
  wired: number;
  hardCircled: number;
  softCircled: number;
  bankableRaised: number;
  remainingGap: number;
  percentToTarget: number;
  /** Live pipeline deals only committed money is counted exactly via its commitment, not weighted. */
  weightedPipeline: number;
  /** Days until targetCloseDate (or firstCloseDate); negative once past; null when neither is set. */
  daysToClose: number | null;
  atRiskCommitments: AtRiskCommitment[];
};

/** A commitment whose expected close date has passed without reaching wired or withdrawn. */
export type AtRiskCommitment = {
  id: string;
  investorName: string;
  amount: number | null;
  status: CommitmentStatus;
  expectedCloseDate: string;
  daysOverdue: number;
};

/**
 * One real transition a commitment made from one confidence status to
 * another, oldest first. The first event on any commitment has
 * fromStatus null that's the commitment being recorded, not a change.
 * What a funding-over-time chart should be built from instead of
 * Commitment.createdAt, which only says when the row was typed in.
 */
export type FundingHistoryEvent = {
  id: string;
  commitmentId: string;
  investorName: string;
  fromStatus: CommitmentStatus | null;
  toStatus: CommitmentStatus;
  amount: number | null;
  createdAt: string;
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

export async function getRoundMetrics(startupId: string, roundId: string) {
  const { data } = await apiClient.get<{ data: RoundMetrics }>(
    `/startups/${startupId}/fundraising-rounds/${roundId}/metrics`,
  );
  return data.data;
}

export async function getFundingHistory(startupId: string, roundId: string) {
  const { data } = await apiClient.get<{ data: FundingHistoryEvent[] }>(
    `/startups/${startupId}/fundraising-rounds/${roundId}/funding-history`,
  );
  return data.data;
}

export async function listCommitments(
  startupId: string,
  roundId?: string,
  status?: CommitmentStatus,
) {
  const path = roundId
    ? `/startups/${startupId}/fundraising-rounds/${roundId}/commitments`
    : `/startups/${startupId}/commitments`;
  const { data } = await apiClient.get<{ data: Commitment[]; meta: PaginationMeta }>(path, {
    params: { limit: 100, ...(status && { status }) },
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
