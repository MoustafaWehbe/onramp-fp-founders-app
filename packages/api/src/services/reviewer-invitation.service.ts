import { randomBytes, createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { hashPassword } from "../utils/auth";
import { isOfficeConvertible } from "./office-convert.service";
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
        watermarkEnabled: row.watermarkEnabled,
        allowPrint: row.allowPrint,
        screenshotGuard: row.screenshotGuard,
        requireNda: row.requireNda,
        hasPassword: Boolean(row.passwordHash),
        allowedEmailDomains: row.allowedEmailDomains,
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

    // A per-invitation guard, not a startup-wide setting: the founder can
    // require that *this* invite's fixed email land on an approved domain
    // (e.g. reject a personal Gmail address for an institutional data room).
    if (input.allowedEmailDomains && input.allowedEmailDomains.length > 0) {
      const emailDomain = emailNormalized.split("@")[1];
      if (!emailDomain || !input.allowedEmailDomains.includes(emailDomain)) {
        throw createError(
          "This email's domain is not in the allowed list for this invitation",
          400,
          "EMAIL_DOMAIN_NOT_ALLOWED",
        );
      }
    }

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

    // The secure viewer serves rendered page images, never the source file.
    // PDFs render directly; DOCX/PPTX render via a LibreOffice conversion
    // step in the rasterize worker (Phase 5). Anything else — XLSX, TXT —
    // has no rendering path and would sit stuck at renderStatus "unsupported"
    // forever, so it's rejected here rather than in the UI: letting it
    // through would leave the reviewer with a document they can open but
    // never view, or worse, tempt a fallback that ships the source file.
    const unsupported = versions.filter(
      (version) => version.mimeType !== "application/pdf" && !isOfficeConvertible(version.mimeType),
    );
    if (unsupported.length > 0) {
      throw createError(
        "Only PDF, Word, and PowerPoint documents can be shared with reviewers. Convert the file and upload a new version.",
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

    // Rendering runs async in the rasterize worker; sharing before it finishes
    // would hand the reviewer a link to a document the secure viewer can't
    // yet serve, landing them on a stuck "still preparing" placeholder.
    const notReady = versions.filter((version) => version.renderStatus !== "ready");
    if (notReady.length > 0) {
      throw createError(
        "One or more documents are still being prepared for secure viewing. Wait a moment and try again.",
        400,
        "RENDER_PENDING",
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
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;

    const invitation = await prisma.reviewerInvitation.create({
      data: {
        startupId,
        startupInvestorId: input.startupInvestorId,
        reviewerName: input.reviewerName,
        emailNormalized,
        tokenHash: hashToken(rawToken),
        status: "pending",
        allowDownload: input.allowDownload ?? false,
        watermarkEnabled: input.watermarkEnabled ?? true,
        allowPrint: input.allowPrint ?? false,
        screenshotGuard: input.screenshotGuard ?? true,
        requireNda: input.requireNda ?? false,
        ndaText: input.requireNda ? input.ndaText : undefined,
        passwordHash,
        allowedEmailDomains: input.allowedEmailDomains ?? [],
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

  /**
   * Per-invitation engagement + security summary for the founder dashboard.
   * Scoped by `startupId_id` the same way `revokeInvitation` is, so a
   * founder from another startup can never resolve this by guessing an id.
   */
  async getInvitationAnalytics(startupId: string, invitationId: string) {
    const invitation = await prisma.reviewerInvitation.findUnique({
      where: { startupId_id: { startupId, id: invitationId } },
      select: {
        id: true,
        reviewerName: true,
        emailNormalized: true,
        status: true,
        revokedAt: true,
        expiresAt: true,
        allowDownload: true,
        watermarkEnabled: true,
        allowPrint: true,
        screenshotGuard: true,
        requireNda: true,
        passwordHash: true,
        allowedEmailDomains: true,
        lastActivityAt: true,
      },
    });
    if (!invitation) throw createError("Invitation not found", 404, "INVITATION_NOT_FOUND");

    const pinnedDocs = await prisma.reviewerInvitationDocument.findMany({
      where: { invitationId },
      include: {
        document: { select: { id: true, title: true } },
        documentVersion: { select: { id: true, pageCount: true } },
      },
    });

    const visits = await prisma.reviewerVisit.findMany({
      where: { invitationId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        startedAt: true,
        lastSeenAt: true,
        endedAt: true,
        totalActiveMs: true,
        pagesViewed: true,
        maxPageReached: true,
        completionPct: true,
        deviceType: true,
        os: true,
        browser: true,
        suspectedForward: true,
        deviceHash: true,
        ipHash: true,
      },
    });

    const summary = {
      visitCount: visits.length,
      totalActiveMs: visits.reduce((sum, v) => sum + v.totalActiveMs, 0),
      lastSeenAt: visits.reduce<Date | null>(
        (latest, v) => (!latest || v.lastSeenAt > latest ? v.lastSeenAt : latest),
        null,
      ),
      completionPct: visits.reduce((max, v) => Math.max(max, v.completionPct), 0),
    };

    // A signal, not proof — the plan is explicit that this is presented as
    // "opened from 2 devices", never as an accusation of leaking the link.
    const forwarding = {
      distinctDevices: new Set(visits.map((v) => v.deviceHash).filter(Boolean)).size,
      distinctIps: new Set(visits.map((v) => v.ipHash).filter(Boolean)).size,
      suspected: visits.some((v) => v.suspectedForward),
    };

    // Skip the page-view query entirely when there are no visits — an empty
    // `visitId: { in: [] }` would just be a wasted round trip.
    const pageRows =
      visits.length === 0
        ? []
        : await prisma.reviewerPageView.groupBy({
            by: ["documentVersionId", "pageNumber"],
            where: { visitId: { in: visits.map((v) => v.id) } },
            _sum: { activeMs: true, viewCount: true },
          });

    const documents = pinnedDocs.map((pinned) => ({
      documentId: pinned.document.id,
      title: pinned.document.title,
      versionId: pinned.documentVersion.id,
      pageCount: pinned.documentVersion.pageCount,
      pages: pageRows
        .filter((row) => row.documentVersionId === pinned.documentVersion.id)
        .map((row) => ({
          pageNumber: row.pageNumber,
          activeMs: row._sum.activeMs ?? 0,
          viewCount: row._sum.viewCount ?? 0,
        }))
        .sort((a, b) => a.pageNumber - b.pageNumber),
    }));

    const [eventCounts, recentEvents] = await Promise.all([
      prisma.reviewerEvent.groupBy({
        by: ["type"],
        where: { invitationId },
        _count: { _all: true },
      }),
      prisma.reviewerEvent.findMany({
        where: { invitationId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { type: true, pageNumber: true, documentVersionId: true, createdAt: true },
      }),
    ]);

    return {
      invitation: {
        id: invitation.id,
        reviewerName: invitation.reviewerName,
        email: invitation.emailNormalized,
        status: deriveStatus(invitation),
        allowDownload: invitation.allowDownload,
        watermarkEnabled: invitation.watermarkEnabled,
        allowPrint: invitation.allowPrint,
        screenshotGuard: invitation.screenshotGuard,
        requireNda: invitation.requireNda,
        hasPassword: Boolean(invitation.passwordHash),
        allowedEmailDomains: invitation.allowedEmailDomains,
        expiresAt: invitation.expiresAt,
        lastActivityAt: invitation.lastActivityAt,
      },
      summary,
      forwarding,
      documents,
      visits: visits.map(({ deviceHash: _deviceHash, ipHash: _ipHash, ...visit }) => visit),
      security: {
        counts: Object.fromEntries(eventCounts.map((row) => [row.type, row._count._all])),
        recent: recentEvents,
      },
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
