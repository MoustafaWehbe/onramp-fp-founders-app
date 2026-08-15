jest.mock("../../src/db/prisma", () => ({
  prisma: {
    reviewerInvitation: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    reviewerSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    reviewerInvitationDocument: {
      findFirst: jest.fn(),
    },
    reviewerComment: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("../../src/jobs/queue", () => ({
  emailQueue: { add: jest.fn() },
}));

jest.mock("../../src/services/storage.service", () => ({
  storageService: {
    createSignedReadUrl: jest.fn(),
  },
}));

jest.mock("../../src/utils/auth", () => ({
  hashToken: jest.fn((v: string) => `hash:${v}`),
  hashOTP: jest.fn((v: string) => `otp:${v}`),
  generateOTP: jest.fn(() => ({ raw: "123456", hash: "otp:123456" })),
}));

import { prisma } from "../../src/db/prisma";
import { emailQueue } from "../../src/jobs/queue";
import { reviewerPortalService } from "../../src/services/reviewer-portal.service";
import { storageService } from "../../src/services/storage.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const INVITE_ID = "00000000-0000-0000-0000-000000000010";
const STARTUP_ID = "00000000-0000-0000-0000-000000000002";

beforeEach(() => jest.clearAllMocks());

describe("ReviewerPortalService.requestAccess", () => {
  it("creates OTP challenge and emails code", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      id: INVITE_ID,
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      emailNormalized: "vc@example.com",
      documents: [],
    } as never);
    mockPrisma.reviewerSession.create.mockResolvedValue({ id: "sess-1" } as never);
    mockPrisma.reviewerInvitation.update.mockResolvedValue({} as never);

    const result = await reviewerPortalService.requestAccess(
      { token: "raw-token-value-1234567890" },
      {},
    );

    expect(result.emailHint).toContain("***");
    expect(emailQueue.add).toHaveBeenCalled();
    expect(mockPrisma.reviewerSession.create).toHaveBeenCalled();
  });

  it("rejects expired invitations", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      id: INVITE_ID,
      status: "pending",
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      emailNormalized: "vc@example.com",
      documents: [],
    } as never);

    await expect(
      reviewerPortalService.requestAccess({ token: "raw-token-value-1234567890" }, {}),
    ).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
  });
});

describe("ReviewerPortalService.getFileAccess", () => {
  it("blocks downloads when allowDownload is false", async () => {
    await expect(
      reviewerPortalService.getFileAccess(INVITE_ID, "doc-1", false, "download"),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FORBIDDEN" });
  });

  it("returns signed url for pinned ready documents", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue({
      documentVersion: {
        id: "ver-1",
        processingStatus: "ready",
        storageKey: "key",
        storageProvider: "local",
        mimeType: "text/plain",
        originalFilename: "deck.txt",
      },
    } as never);
    (storageService.createSignedReadUrl as jest.Mock).mockResolvedValue("/api/v1/documents/local-download/x");

    const result = await reviewerPortalService.getFileAccess(INVITE_ID, "doc-1", true, "preview");
    expect(result.url).toContain("local-download");
    expect(result.versionId).toBe("ver-1");
  });
});
