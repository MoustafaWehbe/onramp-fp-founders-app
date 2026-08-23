import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";

export type ReviewerActivityType =
  | "invitation_created"
  | "invitation_sent"
  | "access_verified"
  | "visit_started"
  | "page_viewed"
  | "comment_added"
  | "security_event"
  | "review_completed"
  | "invitation_revoked";

type ActivityItem = {
  id: string;
  type: ReviewerActivityType;
  occurredAt: Date;
  document: { id: string; title: string; versionId: string } | null;
  pageNumber: number | null;
  details: Record<string, string | number | boolean | null>;
};

export class ReviewerActivityService {
  async list(startupId: string, invitationId: string, limit: number) {
    const invitation = await prisma.reviewerInvitation.findUnique({
      where: { startupId_id: { startupId, id: invitationId } },
      select: {
        id: true,
        createdAt: true,
        deliverySentAt: true,
        completedAt: true,
        revokedAt: true,
      },
    });
    if (!invitation) throw createError("Invitation not found", 404, "INVITATION_NOT_FOUND");

    const [pinned, sessions, visits, pageViews, comments, events] = await Promise.all([
      prisma.reviewerInvitationDocument.findMany({
        where: { invitationId },
        select: {
          documentId: true,
          documentVersionId: true,
          document: { select: { title: true } },
        },
      }),
      prisma.reviewerSession.findMany({
        where: { invitationId, verifiedAt: { not: null } },
        orderBy: { verifiedAt: "desc" },
        take: limit,
        select: { id: true, verifiedAt: true },
      }),
      prisma.reviewerVisit.findMany({
        where: { invitationId },
        orderBy: { startedAt: "desc" },
        take: limit,
        select: {
          id: true,
          startedAt: true,
          totalActiveMs: true,
          pagesViewed: true,
          completionPct: true,
          deviceType: true,
          os: true,
          browser: true,
          suspectedForward: true,
        },
      }),
      prisma.reviewerPageView.findMany({
        where: { visit: { invitationId } },
        orderBy: { firstViewedAt: "desc" },
        take: limit,
        select: {
          id: true,
          documentVersionId: true,
          pageNumber: true,
          firstViewedAt: true,
          activeMs: true,
          viewCount: true,
        },
      }),
      prisma.reviewerComment.findMany({
        where: { startupId, invitationId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          documentId: true,
          documentVersionId: true,
          commentText: true,
          createdAt: true,
          chunk: { select: { documentVersionId: true, pageNumber: true, sectionLabel: true } },
        },
      }),
      prisma.reviewerEvent.findMany({
        where: { startupId, invitationId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, type: true, documentVersionId: true, pageNumber: true, createdAt: true },
      }),
    ]);

    const byVersion = new Map(
      pinned.map((row) => [
        row.documentVersionId,
        { id: row.documentId, title: row.document.title, versionId: row.documentVersionId },
      ]),
    );
    const byDocument = new Map(pinned.map((row) => [row.documentId, byVersion.get(row.documentVersionId)!]));
    const items: ActivityItem[] = [
      {
        id: `invitation-created-${invitation.id}`,
        type: "invitation_created",
        occurredAt: invitation.createdAt,
        document: null,
        pageNumber: null,
        details: {},
      },
    ];

    if (invitation.deliverySentAt) {
      items.push({
        id: `invitation-sent-${invitation.id}`,
        type: "invitation_sent",
        occurredAt: invitation.deliverySentAt,
        document: null,
        pageNumber: null,
        details: {},
      });
    }
    if (invitation.completedAt) {
      items.push({
        id: `review-completed-${invitation.id}`,
        type: "review_completed",
        occurredAt: invitation.completedAt,
        document: null,
        pageNumber: null,
        details: {},
      });
    }
    if (invitation.revokedAt) {
      items.push({
        id: `invitation-revoked-${invitation.id}`,
        type: "invitation_revoked",
        occurredAt: invitation.revokedAt,
        document: null,
        pageNumber: null,
        details: {},
      });
    }

    for (const session of sessions) {
      if (!session.verifiedAt) continue;
      items.push({
        id: `access-verified-${session.id}`,
        type: "access_verified",
        occurredAt: session.verifiedAt,
        document: null,
        pageNumber: null,
        details: {},
      });
    }
    for (const visit of visits) {
      items.push({
        id: `visit-started-${visit.id}`,
        type: "visit_started",
        occurredAt: visit.startedAt,
        document: null,
        pageNumber: null,
        details: {
          totalActiveMs: visit.totalActiveMs,
          pagesViewed: visit.pagesViewed,
          completionPct: visit.completionPct,
          deviceType: visit.deviceType,
          os: visit.os,
          browser: visit.browser,
          suspectedForward: visit.suspectedForward,
        },
      });
    }
    for (const view of pageViews) {
      items.push({
        id: `page-viewed-${view.id}`,
        type: "page_viewed",
        occurredAt: view.firstViewedAt,
        document: byVersion.get(view.documentVersionId) ?? null,
        pageNumber: view.pageNumber,
        details: { activeMs: view.activeMs, viewCount: view.viewCount },
      });
    }
    for (const comment of comments) {
      const versionId = comment.documentVersionId ?? comment.chunk?.documentVersionId;
      items.push({
        id: `comment-added-${comment.id}`,
        type: "comment_added",
        occurredAt: comment.createdAt,
        document: versionId
          ? byVersion.get(versionId) ?? null
          : comment.documentId
            ? byDocument.get(comment.documentId) ?? null
            : null,
        pageNumber: comment.chunk?.pageNumber ?? null,
        details: {
          excerpt: comment.commentText.slice(0, 180),
          sectionLabel: comment.chunk?.sectionLabel ?? null,
        },
      });
    }
    for (const event of events) {
      items.push({
        id: `security-event-${event.id}`,
        type: "security_event",
        occurredAt: event.createdAt,
        document: event.documentVersionId
          ? byVersion.get(event.documentVersionId) ?? null
          : null,
        pageNumber: event.pageNumber,
        details: { eventType: event.type },
      });
    }

    return items
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  }
}

export const reviewerActivityService = new ReviewerActivityService();
