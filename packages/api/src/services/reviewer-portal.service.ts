import { randomBytes } from "crypto";
import type { Response } from "express";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { generateOTP, hashOTP, hashToken } from "../utils/auth";
import { createPageToken, verifyPageToken, PAGE_TOKEN_TTL_SECONDS } from "../utils/page-token";
import { emailQueue } from "../jobs/queue";
import { storageService } from "./storage.service";
import { watermarkService } from "./watermark.service";
import { reviewerOtpEmail } from "../emails/templates/reviewer-otp";
import type {
  ReviewerAccessInput,
  ReviewerCommentInput,
  ReviewerEventInput,
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
                renderStatus: true,
                pageCount: true,
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
        // The viewer addresses documents by version, not by document: the
        // invitation is pinned to one immutable version of each.
        versionId: row.documentVersion.id,
        versionNumber: row.documentVersion.versionNumber,
        renderStatus: row.documentVersion.renderStatus,
        pageCount: row.documentVersion.pageCount,
        summary: row.documentVersion.summary,
        displayOrder: row.displayOrder,
      })),
    };
  }

  /**
   * Resolves a version the invitation is actually pinned to.
   *
   * Every page/download path goes through here rather than trusting a client
   * supplied id: the query is anchored on `invitationId`, so a version
   * belonging to another invitation (or another startup) simply does not match.
   */
  private async requirePinnedVersion(invitationId: string, versionId: string) {
    const pinned = await prisma.reviewerInvitationDocument.findFirst({
      where: { invitationId, documentVersionId: versionId },
      include: {
        document: { select: { id: true, title: true } },
        documentVersion: true,
      },
    });
    if (!pinned) {
      throw createError("Document is not shared with this invitation", 404, "NOT_SHARED");
    }
    return pinned;
  }

  /**
   * Page geometry plus a short-lived token for reading the images.
   *
   * Note what is *not* here: no storage URL, no filename, no bytes of the
   * source object. The manifest is the only way to discover that a version has
   * pages at all, and reaching it already required a verified session.
   */
  async getPageManifest(invitationId: string, sessionId: string, versionId: string) {
    const pinned = await this.requirePinnedVersion(invitationId, versionId);
    const version = pinned.documentVersion;

    if (version.renderStatus === "unsupported") {
      throw createError(
        "This document cannot be displayed in the secure viewer",
        409,
        "RENDER_UNSUPPORTED",
      );
    }
    if (version.renderStatus === "failed") {
      throw createError("This document could not be prepared for viewing", 409, "RENDER_FAILED");
    }
    if (version.renderStatus !== "ready") {
      throw createError("This document is still being prepared", 409, "RENDER_PENDING");
    }

    const pages = await prisma.documentPage.findMany({
      where: { documentVersionId: versionId },
      orderBy: { pageNumber: "asc" },
      select: { pageNumber: true, width: true, height: true },
    });

    return {
      versionId,
      documentId: pinned.document.id,
      title: pinned.document.title,
      versionNumber: version.versionNumber,
      pageCount: pages.length,
      pages,
      pageToken: createPageToken(sessionId, versionId),
      pageTokenExpiresInSeconds: PAGE_TOKEN_TTL_SECONDS,
    };
  }

  /**
   * Returns the bytes of one rendered page.
   *
   * The token proves this session was handed a manifest for this version; the
   * pinned-version check is still repeated because the token is only an
   * authorization hint, never the authority.
   */
  async getPageImage(input: {
    invitationId: string;
    sessionId: string;
    versionId: string;
    pageNumber: number;
    token: string;
    kind: "view" | "thumb";
    email: string;
    watermarkEnabled: boolean;
  }) {
    const claims = verifyPageToken(input.token);
    if (
      !claims ||
      claims.sessionId !== input.sessionId ||
      claims.versionId !== input.versionId
    ) {
      throw createError("Page access token is invalid or expired", 403, "PAGE_TOKEN_INVALID");
    }

    await this.requirePinnedVersion(input.invitationId, input.versionId);

    const page = await prisma.documentPage.findUnique({
      where: {
        documentVersionId_pageNumber: {
          documentVersionId: input.versionId,
          pageNumber: input.pageNumber,
        },
      },
    });
    if (!page) throw createError("Page not found", 404, "PAGE_NOT_FOUND");

    const key = input.kind === "thumb" ? page.thumbStorageKey : page.storageKey;
    const body = await storageService.readObject(key, page.storageProvider);

    // Only the reading surface is watermarked — the thumb strip is a nav
    // aid, not the document itself, and has no consumer yet.
    if (input.kind === "view" && input.watermarkEnabled) {
      const watermarked = await watermarkService.getWatermarkedPage({
        invitationId: input.invitationId,
        versionId: input.versionId,
        pageNumber: input.pageNumber,
        email: input.email,
        buffer: body,
        width: page.width,
        height: page.height,
      });
      return { body: watermarked, contentType: "image/webp" };
    }

    return { body, contentType: "image/webp" };
  }

  /**
   * The only path by which an original file may leave the server, and only when
   * the founder explicitly enabled downloads for this invitation.
   *
   * Streams through the API rather than handing back a signed storage URL, so
   * the object's location is never exposed and the transfer stays attributable.
   */
  async getDownload(invitationId: string, allowDownload: boolean, versionId: string) {
    if (!allowDownload) {
      throw createError("Downloads are disabled for this invitation", 403, "DOWNLOAD_FORBIDDEN");
    }

    const pinned = await this.requirePinnedVersion(invitationId, versionId);
    const version = pinned.documentVersion;
    if (version.processingStatus === "pending_upload") {
      throw createError("Document is not ready", 409, "NOT_READY");
    }

    const body = await storageService.readObject(version.storageKey, version.storageProvider);
    return {
      body,
      mimeType: version.mimeType,
      originalFilename: version.originalFilename,
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

  /**
   * Records a capture-deterrent attempt fired by the client viewer (copy,
   * print, screenshot). Same IDOR rule as every other portal path: a
   * supplied `documentVersionId` is only accepted once it's confirmed pinned
   * to this invitation, never trusted on its own.
   */
  async logEvent(
    startupId: string,
    invitationId: string,
    sessionId: string,
    input: ReviewerEventInput,
  ) {
    if (input.documentVersionId) {
      await this.requirePinnedVersion(invitationId, input.documentVersionId);
    }

    await prisma.reviewerEvent.create({
      data: {
        startupId,
        invitationId,
        sessionId,
        type: input.type,
        documentVersionId: input.documentVersionId,
        pageNumber: input.pageNumber,
      },
    });
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
