import axios from "axios";

/** Separate client so founder /auth/refresh never runs for reviewer 401s. */
export const reviewerPortalClient = axios.create({
  baseURL: "/api/v1/reviewer-portal",
  withCredentials: true,
});

export type ReviewerWorkspace = {
  startup: { id: string; name: string };
  invitation: {
    id: string;
    status: string;
    allowDownload: boolean;
    personalMessage: string | null;
    expiresAt: string;
    reviewerName: string | null;
    email: string;
  };
  documents: Array<{
    documentId: string;
    title: string;
    documentType: string;
    displayOrder: number;
    version: {
      id: string;
      versionNumber: number;
      mimeType: string;
      originalFilename: string;
      fileSize: number | null;
      processingStatus: string;
      summary: string | null;
    };
  }>;
};

export async function requestReviewerAccess(token: string) {
  const { data } = await reviewerPortalClient.post<{
    data: { emailHint: string; expiresInSeconds: number };
  }>("/access", { token });
  return data.data;
}

export async function verifyReviewerAccess(token: string, otp: string) {
  const { data } = await reviewerPortalClient.post<{
    data: {
      session: {
        id: string;
        expiresAt: string | null;
        allowDownload: boolean;
        reviewerName: string | null;
        email: string;
        startupId: string;
      };
    };
  }>("/verify", { token, otp });
  return data.data;
}

export async function getReviewerWorkspace() {
  const { data } = await reviewerPortalClient.get<{ data: ReviewerWorkspace }>("/workspace");
  return data.data;
}

export async function getReviewerFileAccess(
  documentId: string,
  disposition: "preview" | "download" = "preview",
) {
  const { data } = await reviewerPortalClient.post<{
    data: {
      url: string;
      mimeType: string;
      originalFilename: string;
      allowDownload: boolean;
    };
  }>(`/documents/${documentId}/file-access`, undefined, {
    params: { disposition },
  });
  return data.data;
}

export async function listReviewerComments(documentId?: string) {
  const { data } = await reviewerPortalClient.get<{
    data: Array<{
      id: string;
      documentId: string | null;
      commentText: string;
      createdAt: string;
    }>;
  }>("/comments", { params: documentId ? { documentId } : undefined });
  return data.data;
}

export async function createReviewerComment(body: {
  documentId?: string;
  commentText: string;
}) {
  const { data } = await reviewerPortalClient.post("/comments", body);
  return data.data;
}

export async function completeReviewerSession() {
  await reviewerPortalClient.post("/complete");
}

export async function logoutReviewerSession() {
  await reviewerPortalClient.post("/logout");
}
