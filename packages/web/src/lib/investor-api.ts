import { apiClient } from "./api-client";
import type { PipelineStageId } from "./mock-data";

export const INVESTOR_TYPES = ["vc", "angel", "family_office", "accelerator", "other"] as const;
export type InvestorType = (typeof INVESTOR_TYPES)[number];

export const SECTOR_FOCUS_OPTIONS = ["ai_ml", "b2b_saas", "biotech", "climate", "consumer", "developer_tools", "fintech", "healthcare", "marketplaces", "web3", "other"] as const;
export type SectorFocus = (typeof SECTOR_FOCUS_OPTIONS)[number];

export const STAGE_PREFERENCE_OPTIONS = ["pre_seed", "seed", "series_a", "series_b", "growth", "any_stage"] as const;
export type StagePreference = (typeof STAGE_PREFERENCE_OPTIONS)[number];

export const INVESTOR_SOURCE_OPTIONS = ["cold_outreach", "warm_intro", "referral", "event", "accelerator", "inbound", "research", "other"] as const;
export type InvestorSource = (typeof INVESTOR_SOURCE_OPTIONS)[number];

export const INVESTOR_TYPE_LABELS: Record<InvestorType, string> = {
  vc: "VC",
  angel: "Angel",
  family_office: "Family office",
  accelerator: "Accelerator",
  other: "Other",
};

export const SECTOR_FOCUS_LABELS: Record<SectorFocus, string> = {
  ai_ml: "AI & ML", b2b_saas: "B2B SaaS", biotech: "Biotech", climate: "Climate", consumer: "Consumer", developer_tools: "Developer tools", fintech: "Fintech", healthcare: "Healthcare", marketplaces: "Marketplaces", web3: "Web3", other: "Other",
};

export const STAGE_PREFERENCE_LABELS: Record<StagePreference, string> = {
  pre_seed: "Pre-seed", seed: "Seed", series_a: "Series A", series_b: "Series B+", growth: "Growth", any_stage: "Any stage",
};

export const INVESTOR_SOURCE_LABELS: Record<InvestorSource, string> = {
  cold_outreach: "Cold outreach", warm_intro: "Warm intro", referral: "Referral", event: "Event", accelerator: "Accelerator", inbound: "Inbound", research: "Research", other: "Other",
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
  /**
   * Who wrote and last changed `notes`, and when. Server-derived from the
   * authenticated caller — never sent on the way in.
   */
  notesCreatedAt: string | null;
  notesCreatedBy: string | null;
  notesUpdatedAt: string | null;
  notesUpdatedBy: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvestorListItem = InvestorContact & {
  pipeline: {
    id: string;
    /** Which round this entry belongs to — expectedAmount is in that round's currency, not necessarily USD. */
    roundId: string;
    stage: PipelineStageId;
    expectedAmount: number | null;
    probabilityPercentage: number | null;
  } | null;
  /** Legacy: no new logs set a follow-up date — Task superseded it. */
  nextFollowupDate: string | null;
  /** Newest interaction on record for this contact; null if never contacted. */
  lastInteractionDate: string | null;
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
  /** Return this contact's deal for one specific round, when present. */
  roundId?: string;
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
