import { apiClient } from "./api-client";
import type { PipelineStageId } from "./mock-data";

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
  investorId: string;
  investor: PipelineContact;
  stage: PipelineStageId;
  expectedAmount: number | null;
  probabilityPercentage: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type InvestorContact = PipelineContact & {
  pipeline: {
    id: string;
    stage: PipelineStageId;
    expectedAmount: number | null;
    probabilityPercentage: number | null;
  } | null;
  nextFollowupDate: string | null;
};

export async function listPipelineEntries(
  startupId: string,
  params?: { page?: number; limit?: number; stage?: PipelineStageId },
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
    investorId: string;
    stage: PipelineStageId;
    expectedAmount?: number;
    probabilityPercentage?: number;
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
  },
) {
  const { data } = await apiClient.patch<{ data: PipelineEntry }>(
    `/startups/${startupId}/pipeline/${pipelineId}`,
    body,
  );
  return data.data;
}

export async function deletePipelineEntry(startupId: string, pipelineId: string) {
  const { data } = await apiClient.delete<{ message: string }>(
    `/startups/${startupId}/pipeline/${pipelineId}`,
  );
  return data;
}

export async function listInvestorContacts(
  startupId: string,
  params?: { page?: number; limit?: number; search?: string },
) {
  const { data } = await apiClient.get<{ data: InvestorContact[]; meta: PaginationMeta }>(
    `/startups/${startupId}/investors`,
    { params },
  );
  return data;
}

export async function getStartup(startupId: string) {
  const { data } = await apiClient.get<{ data: { id: string; name: string } }>(
    `/startups/${startupId}`,
  );
  return data.data;
}
