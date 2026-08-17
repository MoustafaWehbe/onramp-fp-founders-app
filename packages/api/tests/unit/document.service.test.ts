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
  it("marks version current, sets processing, and enqueues job", async () => {
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
      isCurrent: true,
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

    const result = await documentService.getSignedReadUrl(STARTUP_ID, DOC_ID, VER_ID);
    expect(result.url).toContain("local-download");
    expect(result.mimeType).toBe("text/plain");
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
