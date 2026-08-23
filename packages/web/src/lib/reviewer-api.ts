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
  watermarkEnabled: boolean;
  allowPrint: boolean;
  screenshotGuard: boolean;
  requireNda: boolean;
  hasPassword: boolean;
  allowedEmailDomains: string[];
  personalMessage: string | null;
  deliveryStatus: "unknown" | "queued" | "sent" | "failed" | string;
  deliveryAttempts: number;
  deliveryLastAttemptAt: string | null;
  deliverySentAt: string | null;
  deliveryFailedAt: string | null;
  deliveryError: string | null;
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
    watermarkEnabled?: boolean;
    allowPrint?: boolean;
    screenshotGuard?: boolean;
    requireNda?: boolean;
    password?: string;
    allowedEmailDomains?: string[];
    personalMessage?: string;
    expiresInDays?: number;
    documentVersionIds: string[];
  },
) {
  const { data } = await apiClient.post<{
    data: {
      invitation: {
        id: string;
        email: string;
        status: string;
        expiresAt: string;
        documentCount: number;
        deliveryStatus: string;
      };
      accessToken: string;
      accessUrl: string;
    };
  }>(`/startups/${startupId}/reviewer-invitations`, body);
  return data.data;
}

export async function revokeReviewerInvitation(startupId: string, invitationId: string) {
  await apiClient.post(`/startups/${startupId}/reviewer-invitations/${invitationId}/revoke`);
}

export async function resendReviewerInvitation(startupId: string, invitationId: string) {
  const { data } = await apiClient.post<{
    data: { accessUrl: string; expiresAt: string; deliveryStatus: string };
  }>(`/startups/${startupId}/reviewer-invitations/${invitationId}/resend`);
  return data.data;
}

export type FounderReviewerComment = {
  id: string;
  invitationId: string;
  reviewerName: string | null;
  reviewerEmail: string;
  document: { id: string; title: string; versionId: string | null } | null;
  section: { id: string; label: string | null; pageNumber: number | null } | null;
  commentText: string;
  createdAt: string;
  readAt: string | null;
  resolvedAt: string | null;
  resolvedBy: { id: string; name: string } | null;
};

export function reviewerDocumentContextHref(context: {
  documentId: string;
  versionId?: string | null;
  pageNumber?: number | null;
  sectionLabel?: string | null;
}) {
  const params = new URLSearchParams({ document: context.documentId });
  if (context.versionId) params.set("version", context.versionId);
  if (context.pageNumber) {
    params.set("page", String(context.pageNumber));
    params.set("preview", "1");
  }
  if (context.sectionLabel) params.set("section", context.sectionLabel);
  return `/documents?${params.toString()}`;
}

export async function listFounderReviewerComments(
  startupId: string,
  params: { page?: number; limit?: number; status?: "all" | "unread" | "open" | "resolved" },
) {
  const { data } = await apiClient.get<{
    data: FounderReviewerComment[];
    meta: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      unreadCount: number;
      openCount: number;
    };
  }>(`/startups/${startupId}/reviewer-invitations/comments`, { params });
  return data;
}

export async function markFounderReviewerCommentRead(startupId: string, commentId: string) {
  await apiClient.post(
    `/startups/${startupId}/reviewer-invitations/comments/${commentId}/read`,
  );
}

export async function resolveFounderReviewerComment(startupId: string, commentId: string) {
  await apiClient.post(
    `/startups/${startupId}/reviewer-invitations/comments/${commentId}/resolve`,
  );
}

export type ReviewerInvitationAnalytics = {
  invitation: {
    id: string;
    reviewerName: string | null;
    email: string;
    status: string;
    allowDownload: boolean;
    watermarkEnabled: boolean;
    allowPrint: boolean;
    screenshotGuard: boolean;
    requireNda: boolean;
    hasPassword: boolean;
    allowedEmailDomains: string[];
    expiresAt: string;
    lastActivityAt: string | null;
  };
  summary: {
    visitCount: number;
    totalActiveMs: number;
    lastSeenAt: string | null;
    completionPct: number;
  };
  forwarding: {
    distinctDevices: number;
    distinctIps: number;
    suspected: boolean;
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
    deviceType: string | null;
    os: string | null;
    browser: string | null;
    suspectedForward: boolean;
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

export type ReviewerActivityItem = {
  id: string;
  type:
    | "invitation_created"
    | "invitation_sent"
    | "access_verified"
    | "visit_started"
    | "page_viewed"
    | "comment_added"
    | "security_event"
    | "review_completed"
    | "invitation_revoked";
  occurredAt: string;
  document: { id: string; title: string; versionId: string } | null;
  pageNumber: number | null;
  details: Record<string, string | number | boolean | null>;
};

export async function listReviewerInvitationActivity(
  startupId: string,
  invitationId: string,
  options: { limit?: number; cursor?: string } = {},
) {
  const { data } = await apiClient.get<{
    data: ReviewerActivityItem[];
    pagination: { hasMore: boolean; nextCursor: string | null };
  }>(
    `/startups/${startupId}/reviewer-invitations/${invitationId}/activity`,
    { params: { limit: options.limit ?? 25, cursor: options.cursor } },
  );
  return data;
}
