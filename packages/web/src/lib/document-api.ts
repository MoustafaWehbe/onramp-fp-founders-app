import { apiClient } from "./api-client";

export type DocumentType =
  | "pitch_deck"
  | "financial_model"
  | "cap_table"
  | "term_sheet"
  | "data_room"
  | "other";

export type DocumentVersion = {
  id: string;
  documentId: string;
  versionNumber: number;
  isCurrent: boolean;
  fileSize: number | null;
  mimeType: string;
  originalFilename: string;
  processingStatus: "pending_upload" | "processing" | "ready" | "failed" | string;
  processingError: string | null;
  renderStatus: "pending" | "rendering" | "ready" | "unsupported" | "failed" | string;
  renderError: string | null;
  pageCount: number | null;
  reviewerShareStatus: "processing" | "ready" | "unsupported" | "failed";
  summary: string | null;
  uploadedBy: string;
  // Joined only on getDocument's version history; null from the
  // create/version-upload/confirm responses, where the uploader is the caller.
  uploaderName: string | null;
  createdAt: string;
  hasFile: boolean;
};

export type VaultDocument = {
  id: string;
  startupId: string;
  title: string;
  documentType: DocumentType | string;
  createdBy: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  currentVersion: DocumentVersion | null;
  aiScore: number | null;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export async function getDocument(startupId: string, documentId: string) {
  const { data } = await apiClient.get<{ data: VaultDocument & { versions: DocumentVersion[] } }>(
    `/startups/${startupId}/documents/${documentId}`,
  );
  return data.data;
}

export async function updateDocument(
  startupId: string,
  documentId: string,
  body: { title?: string; documentType?: DocumentType },
) {
  const { data } = await apiClient.patch<{ data: VaultDocument }>(
    `/startups/${startupId}/documents/${documentId}`,
    body,
  );
  return data.data;
}

export async function listDocuments(
  startupId: string,
  params?: {
    page?: number;
    limit?: number;
    search?: string;
    documentType?: string;
    lifecycle?: "active" | "archived" | "all";
  },
) {
  const { data } = await apiClient.get<{ data: VaultDocument[]; meta: PaginationMeta }>(
    `/startups/${startupId}/documents`,
    { params },
  );
  return data;
}

export async function createDocumentUploadSession(
  startupId: string,
  body: {
    title: string;
    documentType: DocumentType;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    summary?: string;
  },
) {
  const { data } = await apiClient.post<{
    data: {
      document: VaultDocument;
      upload: { uploadUrl: string; headers: Record<string, string>; versionId: string };
    };
  }>(`/startups/${startupId}/documents/upload-sessions`, body);
  return data.data;
}

export async function createVersionUploadSession(
  startupId: string,
  documentId: string,
  body: {
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    summary?: string;
  },
) {
  const { data } = await apiClient.post<{
    data: {
      version: DocumentVersion;
      upload: { uploadUrl: string; headers: Record<string, string>; versionId: string };
    };
  }>(`/startups/${startupId}/documents/${documentId}/versions/upload-sessions`, body);
  return data.data;
}

export async function confirmDocumentVersion(
  startupId: string,
  documentId: string,
  versionId: string,
) {
  const { data } = await apiClient.post<{ data: DocumentVersion }>(
    `/startups/${startupId}/documents/${documentId}/versions/${versionId}/confirm`,
  );
  return data.data;
}

export async function getDocumentFileAccess(
  startupId: string,
  documentId: string,
  versionId: string | undefined,
  disposition: "preview" | "download",
) {
  // No JSON body — Express rejects a literal `null` body (`entity.parse.failed`).
  const { data } = await apiClient.request<{
    data: {
      url: string;
      expiresInSeconds: number;
      mimeType: string;
      originalFilename: string;
      versionId: string;
    };
  }>({
    method: "POST",
    url: `/startups/${startupId}/documents/${documentId}/file-access`,
    params: { ...(versionId ? { versionId } : {}), disposition },
  });
  return data.data;
}

export type DocumentAnalytics = {
  document: {
    id: string;
    title: string;
    versionId: string | null;
    versionNumber: number | null;
    pageCount: number | null;
  };
  summary: { viewerCount: number; totalActiveMs: number; avgCompletionPct: number };
  dropOff: Array<{ pageNumber: number; reachedPct: number }>;
  pageAverages: Array<{ pageNumber: number; avgActiveMs: number }>;
  leaderboard: Array<{
    invitationId: string;
    reviewerName: string | null;
    email: string;
    totalActiveMs: number;
    completionPct: number;
  }>;
};

export async function getDocumentAnalytics(startupId: string, documentId: string) {
  const { data } = await apiClient.get<{ data: DocumentAnalytics }>(
    `/startups/${startupId}/documents/${documentId}/analytics`,
  );
  return data.data;
}

export async function deleteDocument(startupId: string, documentId: string) {
  await apiClient.delete(`/startups/${startupId}/documents/${documentId}`);
}

export async function getDocumentPageAccess(
  startupId: string,
  documentId: string,
  versionId: string,
  pageNumber: number,
) {
  const { data } = await apiClient.post<{
    data: {
      url: string;
      expiresInSeconds: number;
      document: { id: string; title: string };
      versionId: string;
      versionNumber: number;
      pageNumber: number;
      width: number;
      height: number;
    };
  }>(
    `/startups/${startupId}/documents/${documentId}/versions/${versionId}/pages/${pageNumber}/access`,
  );
  return data.data;
}

export async function archiveDocument(startupId: string, documentId: string) {
  const { data } = await apiClient.post<{ data: { id: string; archivedAt: string | null } }>(
    `/startups/${startupId}/documents/${documentId}/archive`,
  );
  return data.data;
}

export async function restoreDocument(startupId: string, documentId: string) {
  const { data } = await apiClient.post<{ data: { id: string; archivedAt: string | null } }>(
    `/startups/${startupId}/documents/${documentId}/restore`,
  );
  return data.data;
}

export async function retryDocumentVersion(
  startupId: string,
  documentId: string,
  versionId: string,
) {
  const { data } = await apiClient.post<{ data: DocumentVersion }>(
    `/startups/${startupId}/documents/${documentId}/versions/${versionId}/retry`,
  );
  return data.data;
}

export async function promoteDocumentVersion(
  startupId: string,
  documentId: string,
  versionId: string,
) {
  const { data } = await apiClient.post<{ data: DocumentVersion }>(
    `/startups/${startupId}/documents/${documentId}/versions/${versionId}/promote`,
  );
  return data.data;
}

/** Upload bytes to the signed/local URL returned by createDocumentUploadSession. */
export async function uploadToSignedUrl(
  uploadUrl: string,
  file: File,
  headers: Record<string, string>,
) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || headers["Content-Type"] || "application/octet-stream",
      ...headers,
    },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status})`);
  }
}
