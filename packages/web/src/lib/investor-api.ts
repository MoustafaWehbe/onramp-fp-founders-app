import { apiClient } from "./api-client";
import type { PipelineStageId } from "./mock-data";

export const INVESTOR_TYPES = ["vc", "angel", "family_office", "accelerator", "other"] as const;
export type InvestorType = (typeof INVESTOR_TYPES)[number];

export const INVESTOR_TYPE_LABELS: Record<InvestorType, string> = {
  vc: "VC",
  angel: "Angel",
  family_office: "Family office",
  accelerator: "Accelerator",
  other: "Other",
};

/**
 * Whether this startup has actually approached the contact. Derived server-side
 * from pipeline entries and interaction logs — see ENGAGEMENT_FILTERS in
 * packages/api/src/services/investor.service.ts.
 */
export type Engagement = "engaged" | "prospect";

export type InvestorContact = {
  id: string;
  startupId: string;
  fullName: string;
  email: string | null;
  ventureFirm: string | null;
  investorType: InvestorType | null;
  sectorFocus: string | null;
  investmentStagePreference: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvestorListItem = InvestorContact & {
  pipeline: {
    id: string;
    stage: PipelineStageId;
    expectedAmount: number | null;
    probabilityPercentage: number | null;
  } | null;
  nextFollowupDate: string | null;
};

export type InvestorListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  engagementCounts: { engaged: number; prospect: number };
};

export type ListInvestorsParams = {
  page?: number;
  limit?: number;
  search?: string;
  investorType?: InvestorType;
  stage?: PipelineStageId;
  engagement?: Engagement;
};

/** Optional text fields accept null to clear a stored value. */
export type InvestorInput = {
  fullName: string;
  email?: string | null;
  ventureFirm?: string | null;
  investorType?: InvestorType | null;
  sectorFocus?: string | null;
  investmentStagePreference?: string | null;
  linkedinUrl?: string | null;
  notes?: string | null;
  source?: string | null;
};

export async function listInvestors(startupId: string, params: ListInvestorsParams = {}) {
  const { data } = await apiClient.get<{ data: InvestorListItem[]; meta: InvestorListMeta }>(
    `/startups/${startupId}/investors`,
    { params },
  );
  return data;
}

export async function getInvestor(startupId: string, investorId: string) {
  const { data } = await apiClient.get<{ data: InvestorListItem }>(
    `/startups/${startupId}/investors/${investorId}`,
  );
  return data.data;
}

export async function createInvestor(startupId: string, input: InvestorInput) {
  const { data } = await apiClient.post<{ data: InvestorContact }>(
    `/startups/${startupId}/investors`,
    input,
  );
  return data.data;
}

export async function updateInvestor(
  startupId: string,
  investorId: string,
  input: Partial<InvestorInput>,
) {
  const { data } = await apiClient.patch<{ data: InvestorContact }>(
    `/startups/${startupId}/investors/${investorId}`,
    input,
  );
  return data.data;
}

/**
 * Fails with 409 HAS_DEPENDENTS when the contact has pipeline entries,
 * commitments or interaction logs — the API refuses rather than cascading them
 * away, so callers must surface that instead of retrying.
 */
export async function deleteInvestor(startupId: string, investorId: string) {
  const { data } = await apiClient.delete<{ message: string }>(
    `/startups/${startupId}/investors/${investorId}`,
  );
  return data;
}
