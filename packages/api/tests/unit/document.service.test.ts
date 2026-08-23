jest.mock("../../src/db/prisma", () => ({
  prisma: {
    document: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    documentVersion: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    aiAnalysis: { findMany: jest.fn() },
    reviewerInvitationDocument: { findMany: jest.fn() },
    reviewerVisit: { findMany: jest.fn() },
    reviewerPageView: { findMany: jest.fn() },
    reviewerInvitation: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../src/jobs/queue", () => ({
  documentProcessingQueue: { add: jest.fn() },
  documentRasterizeQueue: { add: jest.fn() },
}));

jest.mock("../../src/services/audit-writer", () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock("../../src/services/storage.service", () => ({
  ...jest.requireActual("../../src/services/storage.service"),
  storageService: {
    assertUploadConstraints: jest.fn(),
    createSignedUpload: jest.fn(),
    getObjectMeta: jest.fn(),
    createSignedReadUrl: jest.fn(),
  },
}));

import { prisma } from "../../src/db/prisma";
import { documentProcessingQueue, documentRasterizeQueue } from "../../src/jobs/queue";
import { documentService } from "../../src/services/document.service";
import { storageService } from "../../src/services/storage.service";
import { recordAuditEvent } from "../../src/services/audit-writer";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockStorage = storageService as jest.Mocked<typeof storageService>;
const mockQueue = documentProcessingQueue as jest.Mocked<typeof documentProcessingQueue>;
const mockRasterizeQueue = documentRasterizeQueue as jest.Mocked<typeof documentRasterizeQueue>;

const STARTUP_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000001";
const DOC_ID = "00000000-0000-0000-0000-00000000000a";
const VER_ID = "00000000-0000-0000-0000-00000000000b";

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(mockPrisma));
});

describe("DocumentService.listDocuments", () => {
  it("requests only archived rows for the archived lifecycle view", async () => {
    mockPrisma.document.count.mockResolvedValue(0);
    mockPrisma.document.findMany.mockResolvedValue([]);

    await documentService.listDocuments(STARTUP_ID, {
      page: 1,
      limit: 20,
      lifecycle: "archived",
    });

    expect(mockPrisma.document.count).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, archivedAt: { not: null } },
    });
  });
});

describe("DocumentService.createUploadSession", () => {
  it("persists document + pending version and returns upload URL", async () => {
    mockStorage.createSignedUpload.mockResolvedValue({
      provider: "local",
      uploadUrl: "/api/v1/documents/local-upload/tok",
      storageKey: "startups/x/documents/y/z/file.txt",
      headers: { "Content-Type": "text/plain" },
    } as never);

    const created = {
      id: DOC_ID,
      startupId: STARTUP_ID,
      title: "Pitch",
      documentType: "pitch_deck",
      createdBy: USER_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const version = {
      id: VER_ID,
      documentId: DOC_ID,
      versionNumber: 1,
      isCurrent: true,
      fileSize: 10,
      mimeType: "text/plain",
      originalFilename: "pitch.txt",
      processingStatus: "pending_upload",
      processingError: null,
      summary: null,
      uploadedBy: USER_ID,
      createdAt: new Date(),
      storageProvider: "local",
      storageKey: "startups/x/documents/y/z/file.txt",
    };

    mockPrisma.document.create.mockResolvedValue(created as never);
    mockPrisma.documentVersion.create.mockResolvedValue(version as never);

    const result = await documentService.createUploadSession(STARTUP_ID, USER_ID, {
      title: "Pitch",
      documentType: "pitch_deck",
      originalFilename: "pitch.txt",
      mimeType: "text/plain",
      fileSize: 10,
    });

    expect(result.upload.uploadUrl).toContain("local-upload");
    expect(result.document.currentVersion?.processingStatus).toBe("pending_upload");
    expect(mockStorage.assertUploadConstraints).toHaveBeenCalledWith("text/plain", 10);
  });
});

describe("DocumentService.confirmVersion", () => {
  it("starts processing without displacing the current version, and enqueues both jobs", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({ id: DOC_ID } as never);
    mockPrisma.documentVersion.findFirst.mockResolvedValue({
      id: VER_ID,
      documentId: DOC_ID,
      processingStatus: "pending_upload",
      storageKey: "key",
      storageProvider: "local",
      versionNumber: 1,
      isCurrent: false,
      fileSize: 10,
      mimeType: "text/plain",
      originalFilename: "pitch.txt",
      processingError: null,
      summary: null,
      uploadedBy: USER_ID,
      createdAt: new Date(),
    } as never);
    mockStorage.getObjectMeta.mockResolvedValue({ size: 10, contentType: "text/plain" });
    mockPrisma.documentVersion.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.documentVersion.update.mockResolvedValue({
      id: VER_ID,
      documentId: DOC_ID,
      versionNumber: 1,
      isCurrent: false,
      fileSize: 10,
      mimeType: "text/plain",
      originalFilename: "pitch.txt",
      processingStatus: "processing",
      processingError: null,
      summary: null,
      uploadedBy: USER_ID,
      createdAt: new Date(),
      storageProvider: "local",
      storageKey: "key",
    } as never);

    const result = await documentService.confirmVersion(STARTUP_ID, DOC_ID, VER_ID);
    expect(result.processingStatus).toBe("processing");
    expect(mockPrisma.documentVersion.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: VER_ID },
      data: {
        fileSize: 10,
        processingStatus: "processing",
        processingError: null,
      },
    });
    expect(mockQueue.add).toHaveBeenCalledWith("process-version", {
      startupId: STARTUP_ID,
      documentId: DOC_ID,
      versionId: VER_ID,
    });
    // Rasterization is queued alongside text extraction so the version becomes
    // viewable in the reviewer portal without a second founder action.
    expect(mockRasterizeQueue.add).toHaveBeenCalledWith("rasterize-version", {
      startupId: STARTUP_ID,
      documentId: DOC_ID,
      versionId: VER_ID,
    });
  });

  it("rejects when uploaded object is missing", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({ id: DOC_ID } as never);
    mockPrisma.documentVersion.findFirst.mockResolvedValue({
      id: VER_ID,
      documentId: DOC_ID,
      processingStatus: "pending_upload",
      storageKey: "key",
      storageProvider: "local",
    } as never);
    mockStorage.getObjectMeta.mockResolvedValue({ size: 0, contentType: null });

    await expect(documentService.confirmVersion(STARTUP_ID, DOC_ID, VER_ID)).rejects.toMatchObject({
      statusCode: 400,
      code: "OBJECT_NOT_FOUND",
    });
  });
});

describe("DocumentService.getDocument", () => {
  it("resolves uploaderName from the joined uploader, and null when a version has none", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({
      id: DOC_ID,
      startupId: STARTUP_ID,
      title: "Pitch deck",
      documentType: "pitch_deck",
      createdBy: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      versions: [
        {
          id: VER_ID,
          documentId: DOC_ID,
          versionNumber: 2,
          isCurrent: true,
          fileSize: 100,
          mimeType: "application/pdf",
          originalFilename: "deck.pdf",
          processingStatus: "ready",
          processingError: null,
          summary: null,
          uploadedBy: "user-1",
          createdAt: new Date(),
          storageProvider: "local",
          storageKey: "key-2",
          uploader: { firstName: "Ada", lastName: "Lovelace" },
        },
        {
          id: "ver-1",
          documentId: DOC_ID,
          versionNumber: 1,
          isCurrent: false,
          fileSize: 90,
          mimeType: "application/pdf",
          originalFilename: "deck-v1.pdf",
          processingStatus: "ready",
          processingError: null,
          summary: null,
          uploadedBy: "deleted-user",
          createdAt: new Date(),
          storageProvider: "local",
          storageKey: "key-1",
          uploader: null,
        },
      ],
    } as never);

    const result = await documentService.getDocument(STARTUP_ID, DOC_ID);

    expect(result.versions).toHaveLength(2);
    expect(result.versions[0].uploaderName).toBe("Ada Lovelace");
    expect(result.versions[1].uploaderName).toBeNull();
    // The joined uploader object itself is an internal detail never returned.
    expect(result.versions[0]).not.toHaveProperty("uploader");
  });

  it("throws DOCUMENT_NOT_FOUND when the document does not exist", async () => {
    mockPrisma.document.findUnique.mockResolvedValue(null);

    await expect(documentService.getDocument(STARTUP_ID, DOC_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "DOCUMENT_NOT_FOUND",
    });
  });
});

describe("DocumentService.getSignedReadUrl", () => {
  it("returns signed access for a ready version", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({
      id: DOC_ID,
      versions: [
        {
          id: VER_ID,
          processingStatus: "ready",
          storageKey: "key",
          storageProvider: "local",
          mimeType: "text/plain",
          originalFilename: "pitch.txt",
        },
      ],
    } as never);
    mockStorage.createSignedReadUrl.mockResolvedValue("/api/v1/documents/local-download/tok");

    const result = await documentService.getSignedReadUrl(STARTUP_ID, DOC_ID, USER_ID, VER_ID);
    expect(result.url).toContain("local-download");
    expect(result.mimeType).toBe("text/plain");
    expect(recordAuditEvent).toHaveBeenCalledWith({
      startupId: STARTUP_ID,
      userId: USER_ID,
      action: "view",
      entityType: "document",
      entityId: DOC_ID,
      changes: { versionId: VER_ID, originalFilename: "pitch.txt" },
    });
  });

  it("records a download separately from a preview", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({
      id: DOC_ID,
      versions: [{
        id: VER_ID,
        processingStatus: "ready",
        storageKey: "key",
        storageProvider: "local",
        mimeType: "application/pdf",
        originalFilename: "deck.pdf",
      }],
    } as never);
    mockStorage.createSignedReadUrl.mockResolvedValue("/api/v1/documents/local-download/tok");

    await documentService.getSignedReadUrl(STARTUP_ID, DOC_ID, USER_ID, VER_ID, "download");

    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "download",
      entityType: "document",
      entityId: DOC_ID,
    }));
  });
});

describe("DocumentService lifecycle operations", () => {
  it("archives a tenant-scoped document without deleting its versions", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({
      id: DOC_ID,
      title: "Pitch deck",
      archivedAt: null,
    } as never);
    mockPrisma.document.update.mockResolvedValue({ id: DOC_ID } as never);

    const result = await documentService.archiveDocument(STARTUP_ID, DOC_ID, USER_ID);

    expect(result.archivedAt).toBeInstanceOf(Date);
    expect(mockPrisma.document.update).toHaveBeenCalledWith({
      where: { id: DOC_ID },
      data: { archivedAt: expect.any(Date) },
    });
    expect(mockPrisma.document.delete).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "archive", entityId: DOC_ID }),
    );
  });

  it("restores an archived document", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({
      id: DOC_ID,
      title: "Pitch deck",
      archivedAt: new Date(),
    } as never);
    mockPrisma.document.update.mockResolvedValue({ id: DOC_ID } as never);

    await documentService.restoreDocument(STARTUP_ID, DOC_ID, USER_ID);

    expect(mockPrisma.document.update).toHaveBeenCalledWith({
      where: { id: DOC_ID },
      data: { archivedAt: null },
    });
  });
});

describe("DocumentService.retryVersion", () => {
  it("retries only the failed processing pipeline", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({ id: DOC_ID, archivedAt: null } as never);
    mockPrisma.documentVersion.findFirst.mockResolvedValue({
      id: VER_ID,
      documentId: DOC_ID,
      versionNumber: 2,
      isCurrent: false,
      fileSize: 100,
      mimeType: "application/pdf",
      originalFilename: "deck.pdf",
      processingStatus: "failed",
      processingError: "parse failed",
      renderStatus: "ready",
      renderError: null,
      pageCount: 4,
      summary: null,
      uploadedBy: USER_ID,
      createdAt: new Date(),
      storageProvider: "local",
      storageKey: "key",
    } as never);
    mockPrisma.documentVersion.update.mockResolvedValue({
      id: VER_ID,
      documentId: DOC_ID,
      versionNumber: 2,
      isCurrent: false,
      fileSize: 100,
      mimeType: "application/pdf",
      originalFilename: "deck.pdf",
      processingStatus: "processing",
      processingError: null,
      renderStatus: "ready",
      renderError: null,
      pageCount: 4,
      summary: null,
      uploadedBy: USER_ID,
      createdAt: new Date(),
      storageProvider: "local",
      storageKey: "key",
    } as never);

    await documentService.retryVersion(STARTUP_ID, DOC_ID, VER_ID, USER_ID);

    expect(mockQueue.add).toHaveBeenCalledWith("process-version", {
      startupId: STARTUP_ID,
      documentId: DOC_ID,
      versionId: VER_ID,
    });
    expect(mockRasterizeQueue.add).not.toHaveBeenCalled();
  });

  it("rejects retrying a healthy version", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({ id: DOC_ID, archivedAt: null } as never);
    mockPrisma.documentVersion.findFirst.mockResolvedValue({
      id: VER_ID,
      documentId: DOC_ID,
      processingStatus: "ready",
      renderStatus: "ready",
    } as never);

    await expect(
      documentService.retryVersion(STARTUP_ID, DOC_ID, VER_ID, USER_ID),
    ).rejects.toMatchObject({ code: "VERSION_NOT_FAILED", statusCode: 409 });
  });
});

describe("DocumentService.promoteVersion", () => {
  it("makes a fully processed historical version current atomically", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({ id: DOC_ID, archivedAt: null } as never);
    mockPrisma.documentVersion.findFirst.mockResolvedValue({
      id: VER_ID,
      documentId: DOC_ID,
      versionNumber: 1,
      isCurrent: false,
      fileSize: 100,
      mimeType: "application/pdf",
      originalFilename: "deck.pdf",
      processingStatus: "ready",
      processingError: null,
      renderStatus: "ready",
      renderError: null,
      pageCount: 4,
      summary: null,
      uploadedBy: USER_ID,
      createdAt: new Date(),
      storageProvider: "local",
      storageKey: "key",
    } as never);
    mockPrisma.documentVersion.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.documentVersion.update.mockResolvedValue({ id: VER_ID, isCurrent: true } as never);

    const result = await documentService.promoteVersion(STARTUP_ID, DOC_ID, VER_ID, USER_ID);

    expect(result.isCurrent).toBe(true);
    expect(mockPrisma.documentVersion.updateMany).toHaveBeenCalledWith({
      where: { documentId: DOC_ID, isCurrent: true, id: { not: VER_ID } },
      data: { isCurrent: false },
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "promote", entityId: VER_ID }),
    );
  });
});

describe("DocumentService.getDocumentAnalytics", () => {
  const INVITE_A = "00000000-0000-0000-0000-0000000000a1";
  const INVITE_B = "00000000-0000-0000-0000-0000000000a2";

  it("404s when the document does not belong to this startup", async () => {
    mockPrisma.document.findUnique.mockResolvedValue(null);

    await expect(documentService.getDocumentAnalytics(STARTUP_ID, DOC_ID)).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
    });
  });

  it("returns a zeroed response when nobody has been pinned to the current version", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({ id: DOC_ID, title: "Seed Deck" } as never);
    mockPrisma.documentVersion.findFirst.mockResolvedValue({
      id: VER_ID,
      versionNumber: 3,
      pageCount: 10,
    } as never);
    mockPrisma.reviewerInvitationDocument.findMany.mockResolvedValue([] as never);

    const result = await documentService.getDocumentAnalytics(STARTUP_ID, DOC_ID);

    expect(result.summary).toEqual({ viewerCount: 0, totalActiveMs: 0, avgCompletionPct: 0 });
    expect(result.dropOff).toEqual([]);
    expect(result.leaderboard).toEqual([]);
    expect(mockPrisma.reviewerVisit.findMany).not.toHaveBeenCalled();
  });

  it("computes drop-off, per-page averages, and a leaderboard across two invitations", async () => {
    mockPrisma.document.findUnique.mockResolvedValue({ id: DOC_ID, title: "Seed Deck" } as never);
    mockPrisma.documentVersion.findFirst.mockResolvedValue({
      id: VER_ID,
      versionNumber: 1,
      pageCount: 4,
    } as never);
    mockPrisma.reviewerInvitationDocument.findMany.mockResolvedValue([
      { invitationId: INVITE_A },
      { invitationId: INVITE_B },
    ] as never);
    mockPrisma.reviewerVisit.findMany.mockResolvedValue([
      { id: "visit-a", invitationId: INVITE_A },
      { id: "visit-b", invitationId: INVITE_B },
    ] as never);
    mockPrisma.reviewerInvitation.findMany.mockResolvedValue([
      { id: INVITE_A, reviewerName: "Ada Investor", emailNormalized: "ada@vc.example" },
      { id: INVITE_B, reviewerName: null, emailNormalized: "bo@vc.example" },
    ] as never);
    // A reached all 4 pages (2s each), B only reached page 2 (10s, more
    // engaged per-page but dropped off earlier) — a good check that
    // "reached further" and "spent more time" aren't conflated.
    mockPrisma.reviewerPageView.findMany.mockResolvedValue([
      { visitId: "visit-a", pageNumber: 1, activeMs: 2000 },
      { visitId: "visit-a", pageNumber: 2, activeMs: 2000 },
      { visitId: "visit-a", pageNumber: 3, activeMs: 2000 },
      { visitId: "visit-a", pageNumber: 4, activeMs: 2000 },
      { visitId: "visit-b", pageNumber: 1, activeMs: 5000 },
      { visitId: "visit-b", pageNumber: 2, activeMs: 5000 },
    ] as never);

    const result = await documentService.getDocumentAnalytics(STARTUP_ID, DOC_ID);

    expect(result.summary).toEqual({ viewerCount: 2, totalActiveMs: 18000, avgCompletionPct: 75 });
    // Both reached pages 1-2 (100%); only A reached 3-4 (50%).
    expect(result.dropOff).toEqual([
      { pageNumber: 1, reachedPct: 100 },
      { pageNumber: 2, reachedPct: 100 },
      { pageNumber: 3, reachedPct: 50 },
      { pageNumber: 4, reachedPct: 50 },
    ]);
    expect(result.pageAverages).toEqual([
      { pageNumber: 1, avgActiveMs: 3500 },
      { pageNumber: 2, avgActiveMs: 3500 },
      { pageNumber: 3, avgActiveMs: 2000 },
      { pageNumber: 4, avgActiveMs: 2000 },
    ]);
    // Sorted by total time descending B spent more despite reaching fewer pages.
    expect(result.leaderboard).toEqual([
      {
        invitationId: INVITE_B,
        reviewerName: null,
        email: "bo@vc.example",
        totalActiveMs: 10000,
        completionPct: 50,
      },
      {
        invitationId: INVITE_A,
        reviewerName: "Ada Investor",
        email: "ada@vc.example",
        totalActiveMs: 8000,
        completionPct: 100,
      },
    ]);
  });
});
