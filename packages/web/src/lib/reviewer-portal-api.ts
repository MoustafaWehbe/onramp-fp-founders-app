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
    allowPrint: boolean;
    screenshotGuard: boolean;
    requireNda: boolean;
    ndaText: string | null;
    ndaAccepted: boolean;
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
    versionId: string;
    versionNumber: number;
    /** pending | rendering | ready | failed | unsupported */
    renderStatus: string;
    pageCount: number | null;
    summary: string | null;
  }>;
};

export type ReviewerPageManifest = {
  versionId: string;
  documentId: string;
  title: string;
  versionNumber: number;
  pageCount: number;
  pages: Array<{ pageNumber: number; width: number; height: number }>;
  pageToken: string;
  pageTokenExpiresInSeconds: number;
};

export async function requestReviewerAccess(token: string, password?: string) {
  const { data } = await reviewerPortalClient.post<{
    data: { emailHint: string; expiresInSeconds: number };
  }>("/access", { token, password });
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

export async function acceptReviewerNda() {
  await reviewerPortalClient.post("/nda/accept");
}

export async function getReviewerPageManifest(versionId: string) {
  const { data } = await reviewerPortalClient.get<{ data: ReviewerPageManifest }>(
    `/documents/${versionId}/manifest`,
  );
  return data.data;
}

/**
 * Fetches one rendered page as bytes.
 *
 * Returned as a blob rather than a URL on purpose: the caller draws it to a
 * canvas and revokes the object URL immediately, so no element in the document
 * holds a src that reproduces the page.
 */
export async function fetchReviewerPage(
  versionId: string,
  pageNumber: number,
  token: string,
  kind: "view" | "thumb" = "view",
  signal?: AbortSignal,
) {
  const { data } = await reviewerPortalClient.get<Blob>(`/pages/${versionId}/${pageNumber}`, {
    params: { t: token, kind },
    responseType: "blob",
    signal,
  });
  return data;
}

export async function downloadReviewerDocument(versionId: string) {
  const response = await reviewerPortalClient.get<Blob>(`/documents/${versionId}/download`, {
    responseType: "blob",
  });
  const disposition = response.headers["content-disposition"] as string | undefined;
  const match = disposition?.match(/filename="([^"]+)"/);
  return {
    blob: response.data,
    filename: match?.[1] ? decodeURIComponent(match[1]) : "document.pdf",
  };
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
  documentVersionId?: string;
  commentText: string;
}) {
  const { data } = await reviewerPortalClient.post("/comments", body);
  return data.data;
}

/**
 * Fire-and-forget: a client guard being blocked shouldn't wait on the
 * network, and a dropped event isn't worth surfacing to the reviewer.
 */
export async function logReviewerEvent(
  type: "copy_attempt" | "print_attempt" | "screenshot_attempt",
  meta?: { documentVersionId?: string; pageNumber?: number },
) {
  await reviewerPortalClient.post("/events", { type, ...meta }).catch(() => {});
}

export type EngagementPayload = {
  pages: Array<{ documentVersionId: string; pageNumber: number; activeMs: number }>;
};

/**
 * Fire-and-forget, same as logReviewerEvent. Prefers sendBeacon so a flush
 * fired from `pagehide` still lands after the page is gone; falls back to a
 * keepalive fetch for browsers/situations where sendBeacon can't be used.
 */
export function flushEngagement(payload: EngagementPayload) {
  if (payload.pages.length === 0) return;

  const url = `${reviewerPortalClient.defaults.baseURL}/telemetry`;
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });

  if (navigator.sendBeacon?.(url, blob)) return;

  void fetch(url, {
    method: "POST",
    body: blob,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
}

export async function completeReviewerSession() {
  await reviewerPortalClient.post("/complete");
}

export async function logoutReviewerSession() {
  await reviewerPortalClient.post("/logout");
}
