import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import type { ReviewerActivityQuery } from "../validators/reviewer.schemas";

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

type ActivityCursor = Pick<ActivityItem, "id" | "occurredAt">;

function encodeCursor(item: ActivityCursor) {
  return Buffer.from(JSON.stringify({ id: item.id, occurredAt: item.occurredAt.toISOString() }))
    .toString("base64url");
}

function decodeCursor(value?: string): ActivityCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      id?: unknown;
      occurredAt?: unknown;
    };
    if (typeof parsed.id !== "string" || typeof parsed.occurredAt !== "string") throw new Error();
    const occurredAt = new Date(parsed.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new Error();
    return { id: parsed.id, occurredAt };
  } catch {
    throw createError("Invalid activity cursor", 400, "INVALID_ACTIVITY_CURSOR");
  }
}

function compareActivity(a: ActivityCursor, b: ActivityCursor) {
  const timeDifference = b.occurredAt.getTime() - a.occurredAt.getTime();
  return timeDifference || b.id.localeCompare(a.id);
}

function isAfterCursor(item: ActivityCursor, cursor: ActivityCursor | null) {
  return cursor === null || compareActivity(item, cursor) > 0;
}

export class ReviewerActivityService {
  async list(startupId: string, invitationId: string, query: ReviewerActivityQuery) {
    const { limit } = query;
    const take = limit + 1;
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

    const cursor = decodeCursor(query.cursor);
    const throughCursor = cursor ? { lte: cursor.occurredAt } : undefined;

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
        where: {
          invitationId,
          verifiedAt: cursor ? { not: null, lte: cursor.occurredAt } : { not: null },
        },
        orderBy: [{ verifiedAt: "desc" }, { id: "desc" }],
        take,
        select: { id: true, verifiedAt: true },
      }),
      prisma.reviewerVisit.findMany({
        where: { invitationId, ...(throughCursor ? { startedAt: throughCursor } : {}) },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take,
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
        where: {
          visit: { invitationId },
          ...(throughCursor ? { firstViewedAt: throughCursor } : {}),
        },
        orderBy: [{ firstViewedAt: "desc" }, { id: "desc" }],
        take,
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
        where: { startupId, invitationId, ...(throughCursor ? { createdAt: throughCursor } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
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
        where: { startupId, invitationId, ...(throughCursor ? { createdAt: throughCursor } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
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

    const eligible = items.sort(compareActivity).filter((item) => isAfterCursor(item, cursor));
    const page = eligible.slice(0, limit);
    const hasMore = eligible.length > limit;

    return {
      data: page,
      pagination: {
        hasMore,
        nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
      },
    };
  }
}

export const reviewerActivityService = new ReviewerActivityService();
