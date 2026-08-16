import { apiClient } from "./api-client";

export function reviewerStatusClass(status: string): string {
  if (status === "in_review" || status === "completed") return "bg-success/15 text-success";
  if (status === "pending" || status === "opened") return "bg-warning/20 text-warning";
  if (status === "revoked") return "bg-destructive/15 text-destructive";
  return "bg-muted text-muted-foreground";
}

export type ReviewerInvitation = {
  id: string;
  startupId: string;
  reviewerName: string | null;
  email: string;
  status: string;
  allowDownload: boolean;
  personalMessage: string | null;
  expiresAt: string;
  completedAt: string | null;
  revokedAt: string | null;
  lastActivityAt: string | null;
  documentCount: number;
  createdAt: string;
  createdBy: { id: string; firstName: string | null; lastName: string | null; email: string };
};

export async function listReviewerInvitations(
  startupId: string,
  params?: { page?: number; limit?: number; search?: string; status?: string },
) {
  const { data } = await apiClient.get<{
    data: ReviewerInvitation[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }>(`/startups/${startupId}/reviewer-invitations`, { params });
  return data;
}

export async function createReviewerInvitation(
  startupId: string,
  body: {
    email: string;
    reviewerName?: string;
    startupInvestorId?: string;
    allowDownload?: boolean;
    personalMessage?: string;
    expiresInDays?: number;
    documentVersionIds: string[];
  },
) {
  const { data } = await apiClient.post<{
    data: {
      invitation: { id: string; email: string; status: string; expiresAt: string; documentCount: number };
      accessToken: string;
      accessUrl: string;
    };
  }>(`/startups/${startupId}/reviewer-invitations`, body);
  return data.data;
}

export async function revokeReviewerInvitation(startupId: string, invitationId: string) {
  await apiClient.post(`/startups/${startupId}/reviewer-invitations/${invitationId}/revoke`);
}

export type ReviewerInvitationAnalytics = {
  invitation: {
    id: string;
    reviewerName: string | null;
    email: string;
    status: string;
    allowDownload: boolean;
    expiresAt: string;
    lastActivityAt: string | null;
  };
  summary: {
    visitCount: number;
    totalActiveMs: number;
    lastSeenAt: string | null;
    completionPct: number;
  };
  documents: Array<{
    documentId: string;
    title: string;
    versionId: string;
    pageCount: number | null;
    pages: Array<{ pageNumber: number; activeMs: number; viewCount: number }>;
  }>;
  visits: Array<{
    id: string;
    startedAt: string;
    lastSeenAt: string;
    endedAt: string | null;
    totalActiveMs: number;
    pagesViewed: number;
    maxPageReached: number;
    completionPct: number;
  }>;
  security: {
    counts: Record<string, number>;
    recent: Array<{
      type: string;
      pageNumber: number | null;
      documentVersionId: string | null;
      createdAt: string;
    }>;
  };
};

export async function getReviewerInvitationAnalytics(startupId: string, invitationId: string) {
  const { data } = await apiClient.get<{ data: ReviewerInvitationAnalytics }>(
    `/startups/${startupId}/reviewer-invitations/${invitationId}/analytics`,
  );
  return data.data;
}
