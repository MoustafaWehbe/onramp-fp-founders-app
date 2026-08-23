import { randomBytes } from "crypto";
import type { Response } from "express";
import { UAParser } from "ua-parser-js";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { logger } from "../utils/logger";
import { generateOTP, hashOTP, hashToken, hashForwardSignal, verifyPassword } from "../utils/auth";
import { createPageToken, verifyPageToken, PAGE_TOKEN_TTL_SECONDS } from "../utils/page-token";
import { emailQueue } from "../jobs/queue";
import { storageService } from "./storage.service";
import { watermarkService, shortLinkId } from "./watermark.service";
import { pdfWatermarkService } from "./pdf-watermark.service";
import { isOfficeConvertible, officeConvertService } from "./office-convert.service";
import { notificationService } from "./notification.service";
import { reviewerOtpEmail } from "../emails/templates/reviewer-otp";
import type {
  ReviewerAccessInput,
  ReviewerCommentInput,
  ReviewerEventInput,
  ReviewerTelemetryInput,
  ReviewerVerifyInput,
} from "../validators/reviewer-portal.schemas";

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === "production";
// Client flushes every 10s; this is that interval plus jitter slack, not the
// schema-level sanity bound (120s) — a hostile client cannot inflate
// engagement by reporting a large activeMs on a single flush.
const MAX_ACTIVE_MS_PER_FLUSH = 12_000;

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

    if (invitation.passwordHash) {
      if (!input.password) {
        throw createError("This link requires a password", 401, "PASSWORD_REQUIRED");
      }
      const valid = await verifyPassword(input.password, invitation.passwordHash);
      if (!valid) {
        throw createError("Incorrect password", 401, "PASSWORD_INVALID");
      }
    }

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
      logger.info({ email: invitation.emailNormalized, otp: raw }, "[reviewer-portal] dev OTP");
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
        allowPrint: invitation.allowPrint,
        screenshotGuard: invitation.screenshotGuard,
        requireNda: invitation.requireNda,
        ndaText: invitation.requireNda ? invitation.ndaText : null,
        ndaAccepted: invitation.ndaAcceptedAt !== null,
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
   * Idempotent: re-accepting an already-accepted NDA just no-ops rather than
   * erroring, since the client may call this defensively before every
   * gated request.
   */
  async acceptNda(invitationId: string, startupId: string, sessionId: string) {
    const invitation = await prisma.reviewerInvitation.findUnique({
      where: { id: invitationId },
      select: { requireNda: true, ndaAcceptedAt: true },
    });
    if (!invitation) throw createError("Invitation not found", 404, "INVITATION_NOT_FOUND");
    if (!invitation.requireNda || invitation.ndaAcceptedAt) return;

    await prisma.reviewerInvitation.update({
      where: { id: invitationId },
      data: { ndaAcceptedAt: new Date(), lastActivityAt: new Date() },
    });
    await prisma.reviewerEvent.create({
      data: { startupId, invitationId, sessionId, type: "nda_accepted" },
    });
  }

  /**
   * Resolves a version the invitation is actually pinned to.
   *
   * Every page/download path goes through here rather than trusting a client
   * supplied id: the query is anchored on `invitationId`, so a version
   * belonging to another invitation (or another startup) simply does not match.
   */
  /**
   * Enforced server-side on every content-bearing endpoint, not just
   * surfaced as a UI gate: `getWorkspace` returns the NDA text unconditionally
   * so the client can render the prompt, but a reviewer who never calls
   * `acceptNda` must not be able to reach a page, manifest, or download.
   */
  private assertNdaAccepted(requireNda: boolean, ndaAccepted: boolean) {
    if (requireNda && !ndaAccepted) {
      throw createError("You must accept the NDA before viewing this document", 409, "NDA_REQUIRED");
    }
  }

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
  async getPageManifest(
    invitationId: string,
    sessionId: string,
    versionId: string,
    startupId: string,
    ndaGate: { requireNda: boolean; ndaAccepted: boolean } = { requireNda: false, ndaAccepted: true },
  ) {
    this.assertNdaAccepted(ndaGate.requireNda, ndaGate.ndaAccepted);
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

    // "X is reading right now": fires once per session, gated on whether a
    // visit already exists for it (visits are created lazily by telemetry,
    // so the very first manifest fetch of a session always precedes one).
    // Never awaited past the lookup — a slow or failing notification must
    // not add latency to the page the reviewer is waiting on.
    const existingVisit = await prisma.reviewerVisit.findUnique({
      where: { sessionId },
      select: { id: true },
    });
    if (!existingVisit) {
      const invitation = await prisma.reviewerInvitation.findUnique({
        where: { id: invitationId },
        select: { createdBy: true, notifyOnOpen: true, reviewerName: true, emailNormalized: true },
      });
      if (invitation?.notifyOnOpen) {
        void notificationService.notifyReviewerOpened({
          userId: invitation.createdBy,
          startupId,
          invitationId,
          reviewerLabel: invitation.reviewerName || invitation.emailNormalized,
          documentTitle: pinned.document.title,
        });
      }
    }

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
    requireNda: boolean;
    ndaAccepted: boolean;
  }) {
    this.assertNdaAccepted(input.requireNda, input.ndaAccepted);

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
  async getDownload(input: {
    invitationId: string;
    startupId: string;
    sessionId: string;
    allowDownload: boolean;
    watermarkEnabled: boolean;
    requireNda: boolean;
    ndaAccepted: boolean;
    versionId: string;
    email: string;
  }) {
    if (!input.allowDownload) {
      throw createError("Downloads are disabled for this invitation", 403, "DOWNLOAD_FORBIDDEN");
    }
    this.assertNdaAccepted(input.requireNda, input.ndaAccepted);

    const pinned = await this.requirePinnedVersion(input.invitationId, input.versionId);
    const version = pinned.documentVersion;
    if (version.processingStatus === "pending_upload") {
      throw createError("Document is not ready", 409, "NOT_READY");
    }

    let body = await storageService.readObject(version.storageKey, version.storageProvider);
    let mimeType = version.mimeType;
    let originalFilename = version.originalFilename;
    if (input.watermarkEnabled) {
      if (isOfficeConvertible(version.mimeType)) {
        body = await officeConvertService.convertToPdf(body, version.mimeType);
        mimeType = "application/pdf";
        originalFilename = version.originalFilename.replace(/\.[^.]+$/, "") + ".pdf";
      } else if (version.mimeType !== "application/pdf") {
        throw createError(
          "A watermarked download is not available for this file type",
          409,
          "WATERMARK_DOWNLOAD_UNSUPPORTED",
        );
      }
      const date = new Date().toISOString().slice(0, 10);
      const text = `${input.email} · ${shortLinkId(input.invitationId)} · ${date}`;
      body = await pdfWatermarkService.watermarkPdf(body, text);
    }

    await prisma.reviewerEvent.create({
      data: {
        startupId: input.startupId,
        invitationId: input.invitationId,
        sessionId: input.sessionId,
        type: "download_completed",
        documentVersionId: input.versionId,
      },
    });
    await prisma.reviewerInvitation.update({
      where: { id: input.invitationId },
      data: { lastActivityAt: new Date() },
    });

    return {
      body,
      mimeType,
      originalFilename,
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
    if (input.chunkId && !input.documentId) {
      throw createError(
        "A document is required when commenting on a document section",
        400,
        "INVALID_COMMENT_TARGET",
      );
    }
    if (input.documentId) {
      const pinned = await prisma.reviewerInvitationDocument.findFirst({
        where: {
          invitationId,
          documentId: input.documentId,
          ...(input.chunkId
            ? { documentVersion: { chunks: { some: { id: input.chunkId } } } }
            : {}),
        },
        select: { id: true },
      });
      if (!pinned) {
        throw createError(
          input.chunkId
            ? "Document section is not shared with this invitation"
            : "Document is not shared with this invitation",
          404,
          "NOT_SHARED",
        );
      }
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

  async recordTelemetry(
    startupId: string,
    invitationId: string,
    sessionId: string,
    input: ReviewerTelemetryInput,
  ) {
    if (input.pages.length === 0) return;

    const pinned = await prisma.reviewerInvitationDocument.findMany({
      where: { invitationId },
      select: { documentVersionId: true, documentVersion: { select: { pageCount: true } } },
    });
    const pinnedIds = new Set(pinned.map((p) => p.documentVersionId));
    const totalPages = pinned.reduce((sum, p) => sum + (p.documentVersion.pageCount ?? 0), 0);

    // Entries for a version this invitation was never pinned to are dropped,
    // not errored — a partially-hostile or stale client shouldn't be able to
    // fail an otherwise-valid batch.
    const validEntries = input.pages
      .filter((p) => pinnedIds.has(p.documentVersionId))
      .map((p) => ({ ...p, activeMs: Math.min(p.activeMs, MAX_ACTIVE_MS_PER_FLUSH) }));
    if (validEntries.length === 0) return;

    const now = new Date();
    const existingVisit = await prisma.reviewerVisit.findUnique({
      where: { sessionId },
      select: { id: true },
    });

    // Device/IP signature only needs computing once per session, at the
    // point the visit row is first created — it can't change mid-session.
    const deviceSignal = existingVisit
      ? null
      : await (async () => {
          const session = await prisma.reviewerSession.findUnique({
            where: { id: sessionId },
            select: { ipAddress: true, userAgent: true },
          });
          const parsed = session?.userAgent ? new UAParser(session.userAgent).getResult() : null;
          return {
            deviceType: parsed?.device.type ?? "desktop",
            os: parsed?.os.name ?? null,
            browser: parsed?.browser.name ?? null,
            deviceHash: session?.userAgent ? hashForwardSignal(session.userAgent) : null,
            ipHash: session?.ipAddress ? hashForwardSignal(session.ipAddress) : null,
          };
        })();

    const visit = await prisma.reviewerVisit.upsert({
      where: { sessionId },
      create: {
        startupId,
        invitationId,
        sessionId,
        startedAt: now,
        lastSeenAt: now,
        ...deviceSignal,
      },
      update: { lastSeenAt: now },
    });

    if (!existingVisit) {
      await this.checkForwarding(startupId, invitationId, sessionId, visit.id);
    }

    await prisma.$transaction(
      validEntries.map((entry) =>
        prisma.reviewerPageView.upsert({
          where: {
            visitId_documentVersionId_pageNumber: {
              visitId: visit.id,
              documentVersionId: entry.documentVersionId,
              pageNumber: entry.pageNumber,
            },
          },
          create: {
            visitId: visit.id,
            documentVersionId: entry.documentVersionId,
            pageNumber: entry.pageNumber,
            firstViewedAt: now,
            lastViewedAt: now,
            activeMs: entry.activeMs,
          },
          update: {
            lastViewedAt: now,
            activeMs: { increment: entry.activeMs },
            viewCount: { increment: 1 },
          },
        }),
      ),
    );

    const [pagesViewed, maxPageAgg, totalActiveAgg] = await Promise.all([
      prisma.reviewerPageView.count({ where: { visitId: visit.id } }),
      prisma.reviewerPageView.aggregate({ where: { visitId: visit.id }, _max: { pageNumber: true } }),
      prisma.reviewerPageView.aggregate({ where: { visitId: visit.id }, _sum: { activeMs: true } }),
    ]);

    await prisma.reviewerVisit.update({
      where: { id: visit.id },
      data: {
        pagesViewed,
        maxPageReached: maxPageAgg._max.pageNumber ?? 0,
        totalActiveMs: totalActiveAgg._sum.activeMs ?? 0,
        completionPct: totalPages > 0 ? Math.round((pagesViewed / totalPages) * 100) : 0,
      },
    });
  }

  /**
   * Runs once per new visit, never per heartbeat. Flags the invitation's
   * newest visit and alerts the founder the moment a second distinct
   * device or IP shows up under one link — a signal the link may have been
   * forwarded, not proof of it (see reviewer-secure-viewer-plan.md §7).
   */
  private async checkForwarding(
    startupId: string,
    invitationId: string,
    sessionId: string,
    visitId: string,
  ) {
    const visits = await prisma.reviewerVisit.findMany({
      where: { invitationId },
      select: { deviceHash: true, ipHash: true },
    });
    const distinctDevices = new Set(visits.map((v) => v.deviceHash).filter(Boolean)).size;
    const distinctIps = new Set(visits.map((v) => v.ipHash).filter(Boolean)).size;
    if (distinctDevices < 2 && distinctIps < 2) return;

    await prisma.reviewerVisit.update({
      where: { id: visitId },
      data: { suspectedForward: true },
    });
    await prisma.reviewerEvent.create({
      data: {
        startupId,
        invitationId,
        sessionId,
        type: "forward_suspected",
        metadata: { distinctDevices, distinctIps },
      },
    });

    const invitation = await prisma.reviewerInvitation.findUnique({
      where: { id: invitationId },
      select: { createdBy: true, reviewerName: true, emailNormalized: true },
    });
    if (invitation) {
      void notificationService.notifyForwardSuspected({
        userId: invitation.createdBy,
        startupId,
        invitationId,
        reviewerLabel: invitation.reviewerName || invitation.emailNormalized,
        distinctDevices,
        distinctIps,
      });
    }
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
    // updateMany, not update: a session that never sent telemetry has no
    // visit row yet, and that's not an error condition.
    await prisma.reviewerVisit.updateMany({
      where: { sessionId, endedAt: null },
      data: { endedAt: new Date() },
    });
  }
}

export const reviewerPortalService = new ReviewerPortalService();
