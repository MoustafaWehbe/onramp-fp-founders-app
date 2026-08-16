import { randomBytes, createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { emailQueue } from "../jobs/queue";
import { getAppUrl } from "../config/env";
import { recordAuditEvent } from "./audit-writer";
import { reviewerInviteEmail } from "../emails/templates/reviewer-invite";
import type {
  CreateReviewerInvitationInput,
  ListReviewerInvitationsQuery,
} from "../validators/reviewer.schemas";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function deriveStatus(row: {
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
}): string {
  if (row.revokedAt || row.status === "revoked") return "revoked";
  if (row.expiresAt.getTime() < Date.now() && row.status !== "completed") return "expired";
  return row.status;
}

export class ReviewerInvitationService {
  async listInvitations(startupId: string, query: ListReviewerInvitationsQuery) {
    const { page, limit, search, status } = query;
    const where: Prisma.ReviewerInvitationWhereInput = {
      startupId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { emailNormalized: { contains: search, mode: "insensitive" } },
              { reviewerName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.reviewerInvitation.count({ where }),
      prisma.reviewerInvitation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          documents: true,
          creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        startupId: row.startupId,
        reviewerName: row.reviewerName,
        email: row.emailNormalized,
        status: deriveStatus(row),
        allowDownload: row.allowDownload,
        personalMessage: row.personalMessage,
        expiresAt: row.expiresAt,
        completedAt: row.completedAt,
        revokedAt: row.revokedAt,
        lastActivityAt: row.lastActivityAt,
        documentCount: row.documents.length,
        createdAt: row.createdAt,
        createdBy: row.creator,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async createInvitation(startupId: string, userId: string, input: CreateReviewerInvitationInput) {
    const emailNormalized = normalizeEmail(input.email);
    const versions = await prisma.documentVersion.findMany({
      where: {
        id: { in: input.documentVersionIds },
        document: { startupId },
        processingStatus: "ready",
      },
      select: { id: true, documentId: true, mimeType: true, renderStatus: true },
    });
    if (versions.length !== input.documentVersionIds.length) {
      throw createError(
        "One or more document versions were not found or are not ready to share",
        400,
        "INVALID_DOCUMENT_VERSIONS",
      );
    }

    // The secure viewer serves rendered page images, and only PDFs can be
    // rendered today. Enforced here rather than in the UI because letting a
    // non-PDF through would leave the reviewer with a document they can open
    // but not view — or worse, tempt a fallback that ships the source file.
    const unsupported = versions.filter((version) => version.mimeType !== "application/pdf");
    if (unsupported.length > 0) {
      throw createError(
        "Only PDF documents can be shared with reviewers. Convert the file to PDF and upload a new version.",
        400,
        "UNSUPPORTED_SHARE_FORMAT",
      );
    }

    const unrenderable = versions.filter((version) => version.renderStatus === "failed");
    if (unrenderable.length > 0) {
      throw createError(
        "One or more documents could not be prepared for secure viewing. Re-upload them and try again.",
        400,
        "RENDER_FAILED",
      );
    }

    if (input.startupInvestorId) {
      const contact = await prisma.startupInvestor.findUnique({
        where: { startupId_id: { startupId, id: input.startupInvestorId } },
        select: { id: true },
      });
      if (!contact) throw createError("Investor contact not found", 404, "INVESTOR_NOT_FOUND");
    }

    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

    const invitation = await prisma.reviewerInvitation.create({
      data: {
        startupId,
        startupInvestorId: input.startupInvestorId,
        reviewerName: input.reviewerName,
        emailNormalized,
        tokenHash: hashToken(rawToken),
        status: "pending",
        allowDownload: input.allowDownload ?? false,
        personalMessage: input.personalMessage,
        expiresAt,
        createdBy: userId,
        documents: {
          create: versions.map((version, index) => ({
            documentId: version.documentId,
            documentVersionId: version.id,
            displayOrder: index,
            addedBy: userId,
          })),
        },
      },
      include: { documents: true },
    });

    const accessUrl = `${getAppUrl()}/review/${rawToken}`;
    try {
      const startup = await prisma.startup.findUnique({
        where: { id: startupId },
        select: { name: true },
      });
      const { subject, html } = reviewerInviteEmail(
        startup?.name ?? "A startup on FP Founders",
        input.reviewerName ?? null,
        accessUrl,
        expiresAt,
        input.personalMessage ?? null,
      );
      await emailQueue.add("send-reviewer-invite", { to: emailNormalized, subject, html });
    } catch {
      // Invitation row still exists; founder can resend later.
    }

    await recordAuditEvent({
      startupId,
      userId,
      action: "create",
      entityType: "reviewer_invitation",
      entityId: invitation.id,
      changes: {
        email: emailNormalized,
        documentCount: invitation.documents.length,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      invitation: {
        id: invitation.id,
        email: invitation.emailNormalized,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        documentCount: invitation.documents.length,
      },
      // Returned once — never stored. Needed so founders can copy the link if email fails.
      accessToken: rawToken,
      accessUrl,
    };
  }

  async revokeInvitation(startupId: string, invitationId: string, userId?: string) {
    const existing = await prisma.reviewerInvitation.findUnique({
      where: { startupId_id: { startupId, id: invitationId } },
      select: { id: true, status: true },
    });
    if (!existing) throw createError("Invitation not found", 404, "INVITATION_NOT_FOUND");

    await prisma.$transaction([
      prisma.reviewerInvitation.update({
        where: { id: invitationId },
        data: {
          status: "revoked",
          revokedAt: new Date(),
          lastActivityAt: new Date(),
        },
      }),
      prisma.reviewerSession.updateMany({
        where: { invitationId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    if (userId) {
      await recordAuditEvent({
        startupId,
        userId,
        action: "revoke",
        entityType: "reviewer_invitation",
        entityId: invitationId,
      });
    }
  }
}

export const reviewerInvitationService = new ReviewerInvitationService();
