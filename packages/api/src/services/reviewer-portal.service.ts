import { randomBytes } from "crypto";
import type { Response } from "express";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { generateOTP, hashOTP, hashToken } from "../utils/auth";
import { emailQueue } from "../jobs/queue";
import { storageService } from "./storage.service";
import { reviewerOtpEmail } from "../emails/templates/reviewer-otp";
import type {
  ReviewerAccessInput,
  ReviewerCommentInput,
  ReviewerVerifyInput,
} from "../validators/reviewer-portal.schemas";

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === "production";

function emailHint(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function invitationFromToken(token: string) {
  return prisma.reviewerInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      documents: {
        orderBy: { displayOrder: "asc" },
        include: {
          document: { select: { id: true, title: true, documentType: true } },
          documentVersion: {
            select: {
              id: true,
              versionNumber: true,
              mimeType: true,
              originalFilename: true,
              fileSize: true,
              processingStatus: true,
              storageKey: true,
              storageProvider: true,
            },
          },
        },
      },
    },
  });
}

function assertInvitationActive(invitation: {
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
}) {
  if (invitation.revokedAt || invitation.status === "revoked") {
    throw createError("This invitation has been revoked", 403, "INVITATION_REVOKED");
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw createError("This invitation has expired", 403, "INVITATION_EXPIRED");
  }
}

export function setReviewerSessionCookie(res: Response, rawToken: string) {
  res.cookie("reviewerSessionToken", rawToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/api/v1/reviewer-portal",
    maxAge: SESSION_TTL_MS,
  });
}

export function clearReviewerSessionCookie(res: Response) {
  res.clearCookie("reviewerSessionToken", { path: "/api/v1/reviewer-portal" });
}

export class ReviewerPortalService {
  async requestAccess(input: ReviewerAccessInput, meta: { ip?: string; userAgent?: string }) {
    const invitation = await invitationFromToken(input.token);
    if (!invitation) throw createError("Invitation not found", 404, "INVITATION_NOT_FOUND");
    assertInvitationActive(invitation);

    const { raw, hash } = generateOTP();
    const session = await prisma.reviewerSession.create({
      data: {
        invitationId: invitation.id,
        verificationCodeHash: hash,
        verificationExpiresAt: new Date(Date.now() + OTP_TTL_MS),
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });

    if (invitation.status === "pending") {
      await prisma.reviewerInvitation.update({
        where: { id: invitation.id },
        data: { status: "opened", lastActivityAt: new Date() },
      });
    } else {
      await prisma.reviewerInvitation.update({
        where: { id: invitation.id },
        data: { lastActivityAt: new Date() },
      });
    }

    const { subject, html } = reviewerOtpEmail(raw);
    await emailQueue.add("send-reviewer-otp", { to: invitation.emailNormalized, subject, html });

    if (process.env.NODE_ENV !== "production") {
      console.info(`[reviewer-portal] OTP for ${invitation.emailNormalized}: ${raw}`);
    }

    return {
      invitationId: invitation.id,
      emailHint: emailHint(invitation.emailNormalized),
      sessionPendingId: session.id,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    };
  }

  async verifyAccess(
    input: ReviewerVerifyInput,
    meta: { ip?: string; userAgent?: string },
  ) {
    const invitation = await invitationFromToken(input.token);
    if (!invitation) throw createError("Invitation not found", 404, "INVITATION_NOT_FOUND");
    assertInvitationActive(invitation);

    const pending = await prisma.reviewerSession.findFirst({
      where: {
        invitationId: invitation.id,
        verifiedAt: null,
        revokedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!pending?.verificationCodeHash || !pending.verificationExpiresAt) {
      throw createError("No pending verification challenge", 400, "NO_CHALLENGE");
    }
    if (pending.verificationExpiresAt.getTime() < Date.now()) {
      throw createError("Verification code expired", 400, "OTP_EXPIRED");
    }
    if (hashOTP(input.otp) !== pending.verificationCodeHash) {
      throw createError("Invalid verification code", 400, "OTP_INVALID");
    }

    const rawSessionToken = randomBytes(32).toString("base64url");
    const updated = await prisma.reviewerSession.update({
      where: { id: pending.id },
      data: {
        sessionTokenHash: hashToken(rawSessionToken),
        verifiedAt: new Date(),
        accessedAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        verificationCodeHash: null,
        verificationExpiresAt: null,
        ipAddress: meta.ip ?? pending.ipAddress,
        userAgent: meta.userAgent ?? pending.userAgent,
      },
    });

    await prisma.reviewerInvitation.update({
      where: { id: invitation.id },
      data: {
        status: invitation.status === "completed" ? invitation.status : "in_review",
        lastActivityAt: new Date(),
      },
    });

    return {
      rawSessionToken,
      session: {
        id: updated.id,
        expiresAt: updated.expiresAt,
        allowDownload: invitation.allowDownload,
        reviewerName: invitation.reviewerName,
        email: invitation.emailNormalized,
        startupId: invitation.startupId,
      },
    };
  }

  async getWorkspace(invitationId: string) {
    const invitation = await prisma.reviewerInvitation.findUnique({
      where: { id: invitationId },
      include: {
        documents: {
          orderBy: { displayOrder: "asc" },
          include: {
            document: { select: { id: true, title: true, documentType: true } },
            documentVersion: {
              select: {
                id: true,
                versionNumber: true,
                mimeType: true,
                originalFilename: true,
                fileSize: true,
                processingStatus: true,
                summary: true,
              },
            },
          },
        },
        startup: { select: { id: true, name: true } },
      },
    });
    if (!invitation) throw createError("Invitation not found", 404, "INVITATION_NOT_FOUND");
    assertInvitationActive(invitation);

    return {
      startup: invitation.startup,
      invitation: {
        id: invitation.id,
        status: invitation.status,
        allowDownload: invitation.allowDownload,
        personalMessage: invitation.personalMessage,
        expiresAt: invitation.expiresAt,
        reviewerName: invitation.reviewerName,
        email: invitation.emailNormalized,
      },
      documents: invitation.documents.map((row) => ({
        documentId: row.document.id,
        title: row.document.title,
        documentType: row.document.documentType,
        version: row.documentVersion,
        displayOrder: row.displayOrder,
      })),
    };
  }

  async getFileAccess(
    invitationId: string,
    documentId: string,
    allowDownload: boolean,
    disposition: "preview" | "download",
  ) {
    if (disposition === "download" && !allowDownload) {
      throw createError("Downloads are disabled for this invitation", 403, "DOWNLOAD_FORBIDDEN");
    }

    const pinned = await prisma.reviewerInvitationDocument.findFirst({
      where: { invitationId, documentId },
      include: { documentVersion: true },
    });
    if (!pinned) throw createError("Document is not shared with this invitation", 404, "NOT_SHARED");
    if (pinned.documentVersion.processingStatus !== "ready") {
      throw createError("Document is not ready", 409, "NOT_READY");
    }

    const url = await storageService.createSignedReadUrl(
      pinned.documentVersion.storageKey,
      pinned.documentVersion.storageProvider,
      300,
      {
        mimeType: pinned.documentVersion.mimeType,
        originalFilename: pinned.documentVersion.originalFilename,
      },
    );

    return {
      url,
      expiresInSeconds: 300,
      mimeType: pinned.documentVersion.mimeType,
      originalFilename: pinned.documentVersion.originalFilename,
      versionId: pinned.documentVersion.id,
      allowDownload,
    };
  }

  async listComments(sessionId: string, startupId: string, documentId?: string) {
    const rows = await prisma.reviewerComment.findMany({
      where: {
        sessionId,
        startupId,
        ...(documentId ? { documentId } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
    return { data: rows };
  }

  async createComment(
    sessionId: string,
    startupId: string,
    invitationId: string,
    input: ReviewerCommentInput,
  ) {
    if (input.documentId) {
      const pinned = await prisma.reviewerInvitationDocument.findFirst({
        where: { invitationId, documentId: input.documentId },
        select: { id: true },
      });
      if (!pinned) throw createError("Document is not shared with this invitation", 404, "NOT_SHARED");
    }

    const comment = await prisma.reviewerComment.create({
      data: {
        sessionId,
        startupId,
        documentId: input.documentId,
        chunkId: input.chunkId,
        commentText: input.commentText,
      },
    });

    await prisma.reviewerInvitation.update({
      where: { id: invitationId },
      data: { lastActivityAt: new Date() },
    });

    return comment;
  }

  async complete(invitationId: string) {
    await prisma.reviewerInvitation.update({
      where: { id: invitationId },
      data: {
        status: "completed",
        completedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });
  }

  async logout(sessionId: string) {
    await prisma.reviewerSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }
}

export const reviewerPortalService = new ReviewerPortalService();
