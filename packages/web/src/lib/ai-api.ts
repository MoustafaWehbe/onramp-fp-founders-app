import { apiClient } from "./api-client";

export type AiSessionDocument = {
  documentId: string;
  documentVersionId: string;
  title: string;
  versionNumber: number;
  processingStatus: string;
};

export type AiSession = {
  id: string;
  startupId: string;
  title: string | null;
  contextMode: "selected" | "workspace";
  roundId?: string;
  documents?: AiSessionDocument[];
  lastMessageAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateAiSessionInput = {
  title?: string;
  contextMode?: "selected" | "workspace";
  roundId?: string;
  documentVersionIds?: string[];
};

export async function listAiSessions(startupId: string) {
  const { data } = await apiClient.get<{ data: AiSession[] }>(`/startups/${startupId}/ai/sessions`);
  return data.data;
}

export async function createAiSession(startupId: string, input: CreateAiSessionInput) {
  const { data } = await apiClient.post<{ data: AiSession }>(`/startups/${startupId}/ai/sessions`, input);
  return data.data;
}
