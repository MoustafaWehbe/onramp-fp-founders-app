import { apiClient } from "./api-client";

export type FundingStage = "pre_seed" | "seed" | "series_a" | "series_b" | "series_c";

export type Startup = {
  id: string;
  name: string;
  description: string | null;
  industry: string | null;
  website: string | null;
  fundingStage: FundingStage;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type StartupMembership = {
  id: string;
  status: string;
  role: string;
  /** The role's live "resource:action" grants — the actual source of truth for what the caller may do. */
  permissions: string[];
  joinedAt: string | null;
};

export type WorkspaceSummary = Startup & { member: StartupMembership };

export type CreateStartupInput = {
  name: string;
  description: string;
  industry: string;
  website: string;
  funding_stage: FundingStage;
};

/**
 * Workspaces the signed-in user can actually open. An empty array is a normal
 * answer — it means the user has no startup yet, not that something failed.
 */
export async function listMyStartups() {
  const { data } = await apiClient.get<{ data: { startups: WorkspaceSummary[] } }>("/startups");
  return data.data.startups;
}

export async function createStartup(input: CreateStartupInput) {
  const { data } = await apiClient.post<{
    data: { startup: Startup; member: { id: string; roleId: string; status: string } };
  }>("/startups", input);
  return data.data;
}

export async function getStartup(startupId: string) {
  const { data } = await apiClient.get<{
    data: { startup: Startup; member: StartupMembership };
  }>(`/startups/${startupId}`);
  return data.data;
}

/**
 * Persists which workspace the user is working in, so the choice follows them
 * to another device rather than living only in this browser's storage.
 */
export async function activateStartup(startupId: string) {
  await apiClient.put(`/startups/${startupId}/activate`);
}

export async function updateStartup(startupId: string, input: Partial<CreateStartupInput>) {
  const { data } = await apiClient.patch<{ data: { startup: Startup } }>(
    `/startups/${startupId}`,
    input,
  );
  return data.data.startup;
}
