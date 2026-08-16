import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { documentProcessingQueue, documentRasterizeQueue } from "../jobs/queue";
import { storageService } from "./storage.service";
import { recordAuditEvent } from "./audit-writer";
import type {
  CreateUploadSessionInput,
  CreateVersionUploadInput,
  ListDocumentsQuery,
  UpdateDocumentInput,
} from "../validators/document.schemas";

function serializeVersion(version: {
  id: string;
  documentId: string;
  versionNumber: number;
  isCurrent: boolean;
  fileSize: number | null;
  mimeType: string;
  originalFilename: string;
  processingStatus: string;
  processingError: string | null;
  summary: string | null;
  uploadedBy: string;
  createdAt: Date;
  storageProvider: string;
  storageKey: string;
  // Only present where a caller actually joined it (getDocument's version
  // history) — on the create/version-upload/confirm paths the uploader is
  // trivially the caller, so nothing bothers to join it there.
  uploader?: { firstName: string; lastName: string } | null;
}) {
  return {
    id: version.id,
    documentId: version.documentId,
    versionNumber: version.versionNumber,
    isCurrent: version.isCurrent,
    fileSize: version.fileSize,
    mimeType: version.mimeType,
    originalFilename: version.originalFilename,
    processingStatus: version.processingStatus,
    processingError: version.processingError,
    summary: version.summary,
    uploadedBy: version.uploadedBy,
    uploaderName: version.uploader ? `${version.uploader.firstName} ${version.uploader.lastName}` : null,
    createdAt: version.createdAt,
    storageProvider: version.storageProvider,
    // Never return permanent storage URLs — clients request signed access.
    hasFile: Boolean(version.storageKey),
  };
}

function serializeDocument(
  doc: {
    id: string;
    startupId: string;
    title: string;
    documentType: string;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
  },
  currentVersion: ReturnType<typeof serializeVersion> | null,
  aiScore: number | null = null,
) {
  return {
    ...doc,
    currentVersion,
    aiScore,
  };
}

export class DocumentService {
  async listDocuments(startupId: string, query: ListDocumentsQuery) {
    const { page, limit, search, documentType } = query;
    const where: Prisma.DocumentWhereInput = {
      startupId,
      ...(documentType ? { documentType } : {}),
      ...(search
        ? { title: { contains: search, mode: "insensitive" } }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          versions: {
            where: { isCurrent: true },
            take: 1,
          },
          aiChatSessions: false,
        },
      }),
    ]);

    const versionIds = rows
      .map((row) => row.versions[0]?.id)
      .filter((id): id is string => Boolean(id));

    const analyses = versionIds.length
      ? await prisma.aiAnalysis.findMany({
          where: { startupId, documentVersionId: { in: versionIds } },
          select: { documentVersionId: true, overallScore: true },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const scoreByVersion = new Map<string, number>();
    for (const row of analyses) {
      if (row.overallScore != null && !scoreByVersion.has(row.documentVersionId)) {
        scoreByVersion.set(row.documentVersionId, row.overallScore);
      }
    }

    return {
      data: rows.map((row) => {
        const current = row.versions[0] ? serializeVersion(row.versions[0]) : null;
        return serializeDocument(
          row,
          current,
          current ? scoreByVersion.get(current.id) ?? null : null,
        );
      }),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getDocument(startupId: string, documentId: string) {
    const doc = await prisma.document.findUnique({
      where: { startupId_id: { startupId, id: documentId } },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          include: { uploader: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!doc) throw createError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    const current = doc.versions.find((v) => v.isCurrent) ?? doc.versions[0] ?? null;
    return {
      ...serializeDocument(doc, current ? serializeVersion(current) : null),
      versions: doc.versions.map(serializeVersion),
    };
  }

  /**
   * Engagement aggregated across every reviewer invitation that has ever
   * been pinned to this document's *current* version. Deliberately scoped
   * to the current version only: page numbers are only meaningful within
   * one version's pagination a drop-off curve mixing page 5 of v1 with
   * page 5 of a re-paginated v2 would describe content that doesn't exist.
   * Older-version engagement is still fully visible per-invitation via
   * getInvitationAnalytics.
   */
  async getDocumentAnalytics(startupId: string, documentId: string) {
    const doc = await prisma.document.findUnique({
      where: { startupId_id: { startupId, id: documentId } },
      select: { id: true, title: true },
    });
    if (!doc) throw createError("Document not found", 404, "DOCUMENT_NOT_FOUND");

    const version = await prisma.documentVersion.findFirst({
      where: { documentId, isCurrent: true },
      select: { id: true, versionNumber: true, pageCount: true },
    });

    const emptyResult = (versionInfo: typeof version) => ({
      document: {
        id: doc!.id,
        title: doc!.title,
        versionId: versionInfo?.id ?? null,
        versionNumber: versionInfo?.versionNumber ?? null,
        pageCount: versionInfo?.pageCount ?? null,
      },
      summary: { viewerCount: 0, totalActiveMs: 0, avgCompletionPct: 0 },
      dropOff: [] as Array<{ pageNumber: number; reachedPct: number }>,
      pageAverages: [] as Array<{ pageNumber: number; avgActiveMs: number }>,
      leaderboard: [] as Array<{
        invitationId: string;
        reviewerName: string | null;
        email: string;
        totalActiveMs: number;
        completionPct: number;
      }>,
    });

    if (!version) return emptyResult(null);

    const pinned = await prisma.reviewerInvitationDocument.findMany({
      where: { documentVersionId: version.id },
      select: { invitationId: true },
    });
    const invitationIds = [...new Set(pinned.map((p) => p.invitationId))];
    if (invitationIds.length === 0) return emptyResult(version);

    const [visits, invitations] = await Promise.all([
      prisma.reviewerVisit.findMany({
        where: { invitationId: { in: invitationIds } },
        select: { id: true, invitationId: true },
      }),
      prisma.reviewerInvitation.findMany({
        where: { id: { in: invitationIds } },
        select: { id: true, reviewerName: true, emailNormalized: true },
      }),
    ]);
    const visitToInvitation = new Map(visits.map((v) => [v.id, v.invitationId]));

    const pageViews =
      visits.length === 0
        ? []
        : await prisma.reviewerPageView.findMany({
            where: { documentVersionId: version.id, visitId: { in: visits.map((v) => v.id) } },
            select: { visitId: true, pageNumber: true, activeMs: true },
          });

    // Three different reductions off the same rows fetched once fine at
    // one document's reviewer-traffic scale rather than three DB-side
    // groupBy round trips shaped differently for each.
    const maxPageByInvitation = new Map<string, number>();
    const pageTotals = new Map<number, { sum: number; count: number }>();
    const activeMsByInvitation = new Map<string, number>();

    for (const view of pageViews) {
      const invitationId = visitToInvitation.get(view.visitId);
      if (!invitationId) continue;

      maxPageByInvitation.set(
        invitationId,
        Math.max(maxPageByInvitation.get(invitationId) ?? 0, view.pageNumber),
      );
      activeMsByInvitation.set(
        invitationId,
        (activeMsByInvitation.get(invitationId) ?? 0) + view.activeMs,
      );
      const bucket = pageTotals.get(view.pageNumber) ?? { sum: 0, count: 0 };
      bucket.sum += view.activeMs;
      bucket.count += 1;
      pageTotals.set(view.pageNumber, bucket);
    }

    const viewerCount = invitationIds.length;
    const pageCount = version.pageCount ?? 0;

    const dropOff = Array.from({ length: pageCount }, (_, index) => {
      const pageNumber = index + 1;
      const reached = [...maxPageByInvitation.values()].filter((max) => max >= pageNumber).length;
      return { pageNumber, reachedPct: viewerCount > 0 ? Math.round((reached / viewerCount) * 100) : 0 };
    });

    const pageAverages = [...pageTotals.entries()]
      .map(([pageNumber, { sum, count }]) => ({ pageNumber, avgActiveMs: Math.round(sum / count) }))
      .sort((a, b) => a.pageNumber - b.pageNumber);

    const totalActiveMs = [...activeMsByInvitation.values()].reduce((sum, ms) => sum + ms, 0);
    const completionPcts = invitationIds.map((id) =>
      pageCount > 0 ? Math.round(((maxPageByInvitation.get(id) ?? 0) / pageCount) * 100) : 0,
    );
    const avgCompletionPct =
      completionPcts.length > 0
        ? Math.round(completionPcts.reduce((sum, pct) => sum + pct, 0) / completionPcts.length)
        : 0;

    const invitationById = new Map(invitations.map((inv) => [inv.id, inv]));
    const leaderboard = invitationIds
      .map((id) => {
        const inv = invitationById.get(id);
        return {
          invitationId: id,
          reviewerName: inv?.reviewerName ?? null,
          email: inv?.emailNormalized ?? "",
          totalActiveMs: activeMsByInvitation.get(id) ?? 0,
          completionPct: pageCount > 0 ? Math.round(((maxPageByInvitation.get(id) ?? 0) / pageCount) * 100) : 0,
        };
      })
      .sort((a, b) => b.totalActiveMs - a.totalActiveMs);

    return {
      document: {
        id: doc.id,
        title: doc.title,
        versionId: version.id,
        versionNumber: version.versionNumber,
        pageCount: version.pageCount,
      },
      summary: { viewerCount, totalActiveMs, avgCompletionPct },
      dropOff,
      pageAverages,
      leaderboard,
    };
  }

  async createUploadSession(startupId: string, userId: string, input: CreateUploadSessionInput) {
    storageService.assertUploadConstraints(input.mimeType, input.fileSize);

    const documentId = randomUUID();
    const versionId = randomUUID();
    const signed = await storageService.createSignedUpload({
      startupId,
      documentId,
      versionId,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
    });

    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          id: documentId,
          startupId,
          title: input.title,
          documentType: input.documentType,
          createdBy: userId,
        },
      });
      const version = await tx.documentVersion.create({
        data: {
          id: versionId,
          documentId,
          versionNumber: 1,
          isCurrent: true,
          storageProvider: signed.provider,
          storageKey: signed.storageKey,
          mimeType: input.mimeType,
          originalFilename: input.originalFilename,
          fileSize: input.fileSize,
          summary: input.summary ?? null,
          processingStatus: "pending_upload",
          uploadedBy: userId,
        },
      });
      return { created, version };
    });

    await recordAuditEvent({
      startupId,
      userId,
      action: "create",
      entityType: "document",
      entityId: documentId,
      changes: {
        title: input.title,
        documentType: input.documentType,
        versionId,
        originalFilename: input.originalFilename,
      },
    });

    return {
      document: serializeDocument(doc.created, serializeVersion(doc.version)),
      upload: {
        uploadUrl: signed.uploadUrl,
        headers: signed.headers ?? {},
        provider: signed.provider,
        versionId,
      },
    };
  }

  async createVersionUploadSession(
    startupId: string,
    documentId: string,
    userId: string,
    input: CreateVersionUploadInput,
  ) {
    storageService.assertUploadConstraints(input.mimeType, input.fileSize);
    const doc = await prisma.document.findUnique({
      where: { startupId_id: { startupId, id: documentId } },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (!doc) throw createError("Document not found", 404, "DOCUMENT_NOT_FOUND");

    const versionId = randomUUID();
    const nextNumber = (doc.versions[0]?.versionNumber ?? 0) + 1;
    const signed = await storageService.createSignedUpload({
      startupId,
      documentId,
      versionId,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
    });

    const version = await prisma.documentVersion.create({
      data: {
        id: versionId,
        documentId,
        versionNumber: nextNumber,
        isCurrent: false,
        storageProvider: signed.provider,
        storageKey: signed.storageKey,
        mimeType: input.mimeType,
        originalFilename: input.originalFilename,
        fileSize: input.fileSize,
        summary: input.summary ?? null,
        processingStatus: "pending_upload",
        uploadedBy: userId,
      },
    });

    await recordAuditEvent({
      startupId,
      userId,
      action: "create",
      entityType: "document_version",
      entityId: versionId,
      changes: {
        documentId,
        versionNumber: nextNumber,
        originalFilename: input.originalFilename,
      },
    });

    return {
      version: serializeVersion(version),
      upload: {
        uploadUrl: signed.uploadUrl,
        headers: signed.headers ?? {},
        provider: signed.provider,
        versionId,
      },
    };
  }

  async confirmVersion(startupId: string, documentId: string, versionId: string) {
    const doc = await prisma.document.findUnique({
      where: { startupId_id: { startupId, id: documentId } },
      select: { id: true },
    });
    if (!doc) throw createError("Document not found", 404, "DOCUMENT_NOT_FOUND");

    const version = await prisma.documentVersion.findFirst({
      where: { id: versionId, documentId },
    });
    if (!version) throw createError("Document version not found", 404, "VERSION_NOT_FOUND");
    if (version.processingStatus !== "pending_upload") {
      return serializeVersion(version);
    }

    const meta = await storageService.getObjectMeta(version.storageKey, version.storageProvider);
    if (!meta.size) {
      throw createError("Uploaded object is empty or missing", 400, "OBJECT_NOT_FOUND");
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.documentVersion.updateMany({
        where: { documentId, isCurrent: true },
        data: { isCurrent: false },
      });
      return tx.documentVersion.update({
        where: { id: versionId },
        data: {
          isCurrent: true,
          fileSize: meta.size,
          processingStatus: "processing",
          processingError: null,
        },
      });
    });

    await documentProcessingQueue.add("process-version", {
      startupId,
      documentId,
      versionId,
    });

    // Independent of text extraction on purpose: a deck can be searchable
    // before it is viewable, and viewable before it is searchable.
    await documentRasterizeQueue.add("rasterize-version", {
      startupId,
      documentId,
      versionId,
    });

    return serializeVersion(updated);
  }

  async updateDocument(startupId: string, documentId: string, input: UpdateDocumentInput) {
    const existing = await prisma.document.findUnique({
      where: { startupId_id: { startupId, id: documentId } },
      select: { id: true },
    });
    if (!existing) throw createError("Document not found", 404, "DOCUMENT_NOT_FOUND");

    const doc = await prisma.document.update({
      where: { id: documentId },
      data: input,
      include: { versions: { where: { isCurrent: true }, take: 1 } },
    });
    return serializeDocument(doc, doc.versions[0] ? serializeVersion(doc.versions[0]) : null);
  }

  async deleteDocument(startupId: string, documentId: string, userId?: string) {
    const existing = await prisma.document.findUnique({
      where: { startupId_id: { startupId, id: documentId } },
      select: {
        id: true,
        title: true,
        versions: {
          select: {
            storageKey: true,
            storageProvider: true,
            // Rendered page images are separate objects under the version
            // prefix; without collecting them here they survive the delete.
            pages: { select: { storageKey: true, thumbStorageKey: true, storageProvider: true } },
          },
        },
      },
    });
    if (!existing) throw createError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    await prisma.document.delete({ where: { id: documentId } });
    await storageService.deleteObjects([
      ...existing.versions.map((v) => ({
        storageKey: v.storageKey,
        storageProvider: v.storageProvider,
      })),
      ...existing.versions.flatMap((v) =>
        v.pages.flatMap((p) => [
          { storageKey: p.storageKey, storageProvider: p.storageProvider },
          { storageKey: p.thumbStorageKey, storageProvider: p.storageProvider },
        ]),
      ),
    ]);
    if (userId) {
      await recordAuditEvent({
        startupId,
        userId,
        action: "delete",
        entityType: "document",
        entityId: documentId,
        changes: { title: existing.title },
      });
    }
  }

  async getSignedReadUrl(startupId: string, documentId: string, versionId?: string) {
    const doc = await prisma.document.findUnique({
      where: { startupId_id: { startupId, id: documentId } },
      include: {
        versions: versionId
          ? { where: { id: versionId }, take: 1 }
          : { where: { isCurrent: true }, take: 1 },
      },
    });
    if (!doc) throw createError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    const version = doc.versions[0];
    if (!version) throw createError("Document version not found", 404, "VERSION_NOT_FOUND");
    if (version.processingStatus === "pending_upload") {
      throw createError("File upload is not complete yet", 409, "UPLOAD_INCOMPLETE");
    }
    const url = await storageService.createSignedReadUrl(
      version.storageKey,
      version.storageProvider,
      300,
      { mimeType: version.mimeType, originalFilename: version.originalFilename },
    );
    return {
      url,
      expiresInSeconds: 300,
      mimeType: version.mimeType,
      originalFilename: version.originalFilename,
      versionId: version.id,
    };
  }
}

export const documentService = new DocumentService();
