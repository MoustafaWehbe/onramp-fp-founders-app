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
    $transaction: jest.fn(),
  },
}));

jest.mock("../../src/jobs/queue", () => ({
  documentProcessingQueue: { add: jest.fn() },
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
import { documentProcessingQueue } from "../../src/jobs/queue";
import { documentService } from "../../src/services/document.service";
import { storageService } from "../../src/services/storage.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockStorage = storageService as jest.Mocked<typeof storageService>;
const mockQueue = documentProcessingQueue as jest.Mocked<typeof documentProcessingQueue>;

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
