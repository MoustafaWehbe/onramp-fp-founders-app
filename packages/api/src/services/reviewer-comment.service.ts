import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";

export type ReviewerCommentStatus = "all" | "unread" | "open" | "resolved";

export class ReviewerCommentService {
  async list(
    startupId: string,
    query: { page: number; limit: number; status: ReviewerCommentStatus },
  ) {
    const statusWhere: Prisma.ReviewerCommentWhereInput =
      query.status === "unread"
        ? { readAt: null, resolvedAt: null }
        : query.status === "open"
          ? { resolvedAt: null }
          : query.status === "resolved"
            ? { resolvedAt: { not: null } }
            : {};
    const where: Prisma.ReviewerCommentWhereInput = { startupId, ...statusWhere };

    const [rows, total, unreadCount, openCount] = await Promise.all([
      prisma.reviewerComment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          invitation: {
            select: {
              id: true,
              reviewerName: true,
              emailNormalized: true,
              documents: { select: { documentId: true, documentVersionId: true } },
            },
          },
          document: { select: { id: true, title: true } },
          chunk: {
            select: {
              id: true,
              documentVersionId: true,
              sectionLabel: true,
              pageNumber: true,
            },
          },
          resolver: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.reviewerComment.count({ where }),
      prisma.reviewerComment.count({ where: { startupId, readAt: null, resolvedAt: null } }),
      prisma.reviewerComment.count({ where: { startupId, resolvedAt: null } }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        invitationId: row.invitationId,
        reviewerName: row.invitation.reviewerName,
        reviewerEmail: row.invitation.emailNormalized,
        document: row.document
          ? {
              ...row.document,
              versionId:
                row.chunk?.documentVersionId ??
                row.invitation.documents.find((item) => item.documentId === row.documentId)
                  ?.documentVersionId ??
                null,
            }
          : null,
        section: row.chunk
          ? { id: row.chunk.id, label: row.chunk.sectionLabel, pageNumber: row.chunk.pageNumber }
          : null,
        commentText: row.commentText,
        createdAt: row.createdAt,
        readAt: row.readAt,
        resolvedAt: row.resolvedAt,
        resolvedBy: row.resolver
          ? {
              id: row.resolver.id,
              name: `${row.resolver.firstName} ${row.resolver.lastName}`.trim(),
            }
          : null,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
        unreadCount,
        openCount,
      },
    };
  }

  async markRead(startupId: string, commentId: string) {
    const result = await prisma.reviewerComment.updateMany({
      where: { id: commentId, startupId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count > 0) return;
    const exists = await prisma.reviewerComment.findFirst({ where: { id: commentId, startupId } });
    if (!exists) throw createError("Reviewer comment not found", 404, "COMMENT_NOT_FOUND");
  }

  async resolve(startupId: string, commentId: string, userId: string) {
    const now = new Date();
    const result = await prisma.reviewerComment.updateMany({
      where: { id: commentId, startupId, resolvedAt: null },
      data: { readAt: now, resolvedAt: now, resolvedBy: userId },
    });
    if (result.count > 0) return;
    const exists = await prisma.reviewerComment.findFirst({ where: { id: commentId, startupId } });
    if (!exists) throw createError("Reviewer comment not found", 404, "COMMENT_NOT_FOUND");
  }
}

export const reviewerCommentService = new ReviewerCommentService();
