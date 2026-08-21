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
  persona?: { id: string; name: string | null; description: string | null } | null;
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

export type AiCitation = {
  id: string;
  sourceType: string;
  sourceId: string;
  label: string;
  excerpt: string | null;
  metadata: unknown;
  sortOrder: number;
};

export type AiToolCallActivity = { callId: string; name: string; status: "started" | "completed" | "failed" };

export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  citations: AiCitation[];
  artifacts: AiArtifact[];
  // Populated live from tool.started/tool.completed SSE events during an active
  // generation; the server does not persist or replay these on a fresh page load.
  toolCalls?: AiToolCallActivity[];
};

export type AiArtifact = {
  id: string;
  type: string;
  title: string | null;
  status: "building" | "ready" | "failed" | string;
  data: unknown;
  createdAt: string;
};

export type AiStreamEvent = {
  sequence: number;
  type: "stream.ready" | "message.started" | "message.delta" | "citation.added" | "artifact.ready" | "artifact.failed" | "message.snapshot" | "tool.started" | "tool.completed" | "message.completed" | "message.failed" | "message.cancelled";
  payload: Record<string, unknown>;
};

export type AiAnalysisEvidenceItem = { documentChunkId: string; label: string; excerpt: string };
export type AiAnalysisResultShape = {
  schemaVersion: string;
  executiveSummary: string;
  scores: { overall: number; narrative: number; marketValidation: number; financial: number; confidence: number };
  strengths: Array<{ statement: string; evidence: AiAnalysisEvidenceItem[] }>;
  gaps: Array<{ section: string; status: string; issue: string; severity: string; recommendation: string; evidence: AiAnalysisEvidenceItem[] }>;
  personas: Array<{ name: string; investmentLens: string; whyTheyCare: string; likelyObjections: string[]; questions: string[] }>;
};

export type AiAnalysis = {
  id: string;
  startupId: string;
  documentVersionId: string;
  sessionId: string | null;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  overallScore: number | null;
  narrativeScore: number | null;
  marketValidationScore: number | null;
  financialScore: number | null;
  confidenceScore: number | null;
  summaryReport: string | null;
  result: AiAnalysisResultShape | null;
  errorMessage: string | null;
  createdAt: string;
};

export async function listAiSessions(startupId: string) {
  const { data } = await apiClient.get<{ data: AiSession[] }>(`/startups/${startupId}/ai/sessions`);
  return data.data;
}

export async function createAiSession(startupId: string, input: CreateAiSessionInput) {
  const { data } = await apiClient.post<{ data: AiSession }>(`/startups/${startupId}/ai/sessions`, input);
  return data.data;
}

export async function updateAiSession(startupId: string, sessionId: string, input: { title?: string; personaId?: string | null }) {
  const { data } = await apiClient.patch<{ data: AiSession }>(`/startups/${startupId}/ai/sessions/${sessionId}`, input);
  return data.data;
}

export async function archiveAiSession(startupId: string, sessionId: string) {
  await apiClient.delete(`/startups/${startupId}/ai/sessions/${sessionId}`);
}

export async function listAiMessages(startupId: string, sessionId: string) {
  const { data } = await apiClient.get<{ data: AiChatMessage[] }>(`/startups/${startupId}/ai/sessions/${sessionId}/messages`);
  return data.data;
}

export async function createAiMessage(startupId: string, sessionId: string, content: string, clientRequestId: string) {
  const { data } = await apiClient.post<{ data: { assistantMessageId: string; status: AiChatMessage["status"]; created: boolean; streamUrl: string } }>(
    `/startups/${startupId}/ai/sessions/${sessionId}/messages`,
    { content, clientRequestId },
  );
  return data.data;
}

export async function cancelAiMessage(startupId: string, sessionId: string, messageId: string) {
  await apiClient.post(`/startups/${startupId}/ai/sessions/${sessionId}/messages/${messageId}/cancel`);
}

export type AiAgentAction = {
  id: string;
  actionType: "create_task" | "log_interaction" | "schedule_meeting" | "send_investor_email" | "update_deal_stage" | "update_task_status";
  status: "proposed" | "approved" | "executed" | "rejected" | "failed" | "expired";
  resultRef: unknown;
};

/** Delegates to the exact same service the manual UI button uses — the click that actually sends/schedules/creates/moves whatever the copilot drafted. */
export async function approveAiAction(startupId: string, actionId: string, payload?: Record<string, unknown>) {
  const { data } = await apiClient.post<{ data: { action: AiAgentAction; result: unknown } }>(
    `/startups/${startupId}/ai/actions/${actionId}/approve`,
    payload ? { payload } : {},
  );
  return data.data;
}

export async function rejectAiAction(startupId: string, actionId: string) {
  const { data } = await apiClient.post<{ data: AiAgentAction }>(`/startups/${startupId}/ai/actions/${actionId}/reject`);
  return data.data;
}

export async function listAiAnalyses(startupId: string, filter?: { documentVersionId?: string; sessionId?: string }) {
  const { data } = await apiClient.get<{ data: AiAnalysis[] }>(`/startups/${startupId}/ai/analyses`, { params: filter });
  return data.data;
}

export async function createAiAnalysis(startupId: string, input: { documentVersionId: string; sessionId?: string }) {
  const { data } = await apiClient.post<{ data: AiAnalysis }>(`/startups/${startupId}/ai/analyses`, input);
  return data.data;
}

export async function cancelAiAnalysis(startupId: string, analysisId: string) {
  await apiClient.post(`/startups/${startupId}/ai/analyses/${analysisId}/cancel`);
}

export async function getAiAnalysis(startupId: string, analysisId: string) {
  const { data } = await apiClient.get<{ data: AiAnalysis & { personas: Array<{ id: string; personaName: string | null; description: string | null; questions: Array<{ id: string; questionText: string | null }> }> } }>(`/startups/${startupId}/ai/analyses/${analysisId}`);
  return data.data;
}
