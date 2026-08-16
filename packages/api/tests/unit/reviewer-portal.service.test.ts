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
    documentPage: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    reviewerEvent: {
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
    readObject: jest.fn(),
  },
}));

jest.mock("../../src/services/watermark.service", () => ({
  watermarkService: {
    getWatermarkedPage: jest.fn(),
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
import { watermarkService } from "../../src/services/watermark.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const INVITE_ID = "00000000-0000-0000-0000-000000000010";

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

const SESSION_ID = "00000000-0000-0000-0000-000000000020";
const VERSION_ID = "00000000-0000-0000-0000-000000000030";
const OTHER_VERSION_ID = "00000000-0000-0000-0000-000000000031";

function pinnedVersion(overrides: Record<string, unknown> = {}) {
  return {
    document: { id: "doc-1", title: "Seed Deck" },
    documentVersion: {
      id: VERSION_ID,
      versionNumber: 2,
      renderStatus: "ready",
      processingStatus: "ready",
      storageKey: "startups/s/documents/d/v/deck.pdf",
      storageProvider: "local",
      mimeType: "application/pdf",
      originalFilename: "deck.pdf",
      ...overrides,
    },
  };
}

describe("ReviewerPortalService.getPageManifest", () => {
  it("returns page geometry and a token, and never a storage location", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    mockPrisma.documentPage.findMany.mockResolvedValue([
      { pageNumber: 1, width: 1600, height: 2070 },
      { pageNumber: 2, width: 1600, height: 2070 },
    ] as never);

    const result = await reviewerPortalService.getPageManifest(
      INVITE_ID,
      SESSION_ID,
      VERSION_ID,
    );

    expect(result.pageCount).toBe(2);
    expect(result.pageToken).toEqual(expect.any(String));
    // The whole point of the redesign: nothing that locates the source object
    // may appear in a portal response.
    expect(JSON.stringify(result)).not.toContain("startups/s/documents");
    expect(JSON.stringify(result)).not.toContain("deck.pdf");
  });

  it("refuses a version that is not pinned to this invitation", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(null as never);

    await expect(
      reviewerPortalService.getPageManifest(INVITE_ID, SESSION_ID, OTHER_VERSION_ID),
    ).rejects.toMatchObject({ code: "NOT_SHARED" });
  });

  it("reports a version that has not finished rendering", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(
      pinnedVersion({ renderStatus: "rendering" }) as never,
    );

    await expect(
      reviewerPortalService.getPageManifest(INVITE_ID, SESSION_ID, VERSION_ID),
    ).rejects.toMatchObject({ code: "RENDER_PENDING" });
  });
});

describe("ReviewerPortalService.getPageImage", () => {
  async function tokenFor(sessionId: string, versionId: string) {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(
      pinnedVersion({ id: versionId }) as never,
    );
    mockPrisma.documentPage.findMany.mockResolvedValue([] as never);
    const { pageToken } = await reviewerPortalService.getPageManifest(
      INVITE_ID,
      sessionId,
      versionId,
    );
    return pageToken;
  }

  it("serves page bytes for a valid token", async () => {
    const token = await tokenFor(SESSION_ID, VERSION_ID);
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    mockPrisma.documentPage.findUnique.mockResolvedValue({
      storageKey: "startups/s/documents/d/v/pages/1.webp",
      thumbStorageKey: "startups/s/documents/d/v/thumbs/1.webp",
      storageProvider: "local",
      width: 1600,
      height: 2070,
    } as never);
    (storageService.readObject as jest.Mock).mockResolvedValue(Buffer.from("webp-bytes"));

    const result = await reviewerPortalService.getPageImage({
      invitationId: INVITE_ID,
      sessionId: SESSION_ID,
      versionId: VERSION_ID,
      pageNumber: 1,
      token,
      kind: "view",
      email: "vc@example.com",
      watermarkEnabled: false,
    });

    expect(result.contentType).toBe("image/webp");
    expect(result.body.toString()).toBe("webp-bytes");
    expect(watermarkService.getWatermarkedPage).not.toHaveBeenCalled();
  });

  it("watermarks the view rendition when enabled", async () => {
    const token = await tokenFor(SESSION_ID, VERSION_ID);
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    mockPrisma.documentPage.findUnique.mockResolvedValue({
      storageKey: "startups/s/documents/d/v/pages/1.webp",
      thumbStorageKey: "startups/s/documents/d/v/thumbs/1.webp",
      storageProvider: "local",
      width: 1600,
      height: 2070,
    } as never);
    (storageService.readObject as jest.Mock).mockResolvedValue(Buffer.from("webp-bytes"));
    (watermarkService.getWatermarkedPage as jest.Mock).mockResolvedValue(
      Buffer.from("watermarked-bytes"),
    );

    const result = await reviewerPortalService.getPageImage({
      invitationId: INVITE_ID,
      sessionId: SESSION_ID,
      versionId: VERSION_ID,
      pageNumber: 1,
      token,
      kind: "view",
      email: "vc@example.com",
      watermarkEnabled: true,
    });

    expect(watermarkService.getWatermarkedPage).toHaveBeenCalledWith(
      expect.objectContaining({ email: "vc@example.com", width: 1600, height: 2070 }),
    );
    expect(result.body.toString()).toBe("watermarked-bytes");
  });

  it("never watermarks the thumb rendition", async () => {
    const token = await tokenFor(SESSION_ID, VERSION_ID);
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    mockPrisma.documentPage.findUnique.mockResolvedValue({
      storageKey: "startups/s/documents/d/v/pages/1.webp",
      thumbStorageKey: "startups/s/documents/d/v/thumbs/1.webp",
      storageProvider: "local",
      width: 220,
      height: 285,
    } as never);
    (storageService.readObject as jest.Mock).mockResolvedValue(Buffer.from("thumb-bytes"));

    const result = await reviewerPortalService.getPageImage({
      invitationId: INVITE_ID,
      sessionId: SESSION_ID,
      versionId: VERSION_ID,
      pageNumber: 1,
      token,
      kind: "thumb",
      email: "vc@example.com",
      watermarkEnabled: true,
    });

    expect(watermarkService.getWatermarkedPage).not.toHaveBeenCalled();
    expect(result.body.toString()).toBe("thumb-bytes");
  });

  it("rejects a token minted for a different session", async () => {
    const token = await tokenFor("00000000-0000-0000-0000-0000000000ff", VERSION_ID);

    await expect(
      reviewerPortalService.getPageImage({
        invitationId: INVITE_ID,
        sessionId: SESSION_ID,
        versionId: VERSION_ID,
        pageNumber: 1,
        token,
        kind: "view",
        email: "vc@example.com",
        watermarkEnabled: false,
      }),
    ).rejects.toMatchObject({ code: "PAGE_TOKEN_INVALID" });
  });

  it("rejects a token minted for a different version", async () => {
    const token = await tokenFor(SESSION_ID, OTHER_VERSION_ID);

    await expect(
      reviewerPortalService.getPageImage({
        invitationId: INVITE_ID,
        sessionId: SESSION_ID,
        versionId: VERSION_ID,
        pageNumber: 1,
        token,
        kind: "view",
        email: "vc@example.com",
        watermarkEnabled: false,
      }),
    ).rejects.toMatchObject({ code: "PAGE_TOKEN_INVALID" });
  });

  it("still checks the pin even when the token verifies", async () => {
    const token = await tokenFor(SESSION_ID, VERSION_ID);
    // Simulates access being revoked between manifest and page read.
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(null as never);

    await expect(
      reviewerPortalService.getPageImage({
        invitationId: INVITE_ID,
        sessionId: SESSION_ID,
        versionId: VERSION_ID,
        pageNumber: 1,
        token,
        kind: "view",
        email: "vc@example.com",
        watermarkEnabled: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_SHARED" });
  });
});

const STARTUP_ID = "00000000-0000-0000-0000-000000000001";

describe("ReviewerPortalService.logEvent", () => {
  it("writes an event with no document context", async () => {
    mockPrisma.reviewerEvent.create.mockResolvedValue({} as never);

    await reviewerPortalService.logEvent(STARTUP_ID, INVITE_ID, SESSION_ID, {
      type: "copy_attempt",
    });

    expect(mockPrisma.reviewerInvitationDocument.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.reviewerEvent.create).toHaveBeenCalledWith({
      data: {
        startupId: STARTUP_ID,
        invitationId: INVITE_ID,
        sessionId: SESSION_ID,
        type: "copy_attempt",
        documentVersionId: undefined,
        pageNumber: undefined,
      },
    });
  });

  it("validates a supplied documentVersionId is pinned to this invitation", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    mockPrisma.reviewerEvent.create.mockResolvedValue({} as never);

    await reviewerPortalService.logEvent(STARTUP_ID, INVITE_ID, SESSION_ID, {
      type: "print_attempt",
      documentVersionId: VERSION_ID,
    });

    expect(mockPrisma.reviewerInvitationDocument.findFirst).toHaveBeenCalled();
    expect(mockPrisma.reviewerEvent.create).toHaveBeenCalled();
  });

  it("rejects a documentVersionId that is not pinned to this invitation, same IDOR rule as everywhere else", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(null as never);

    await expect(
      reviewerPortalService.logEvent(STARTUP_ID, INVITE_ID, SESSION_ID, {
        type: "screenshot_attempt",
        documentVersionId: OTHER_VERSION_ID,
      }),
    ).rejects.toMatchObject({ code: "NOT_SHARED" });
    expect(mockPrisma.reviewerEvent.create).not.toHaveBeenCalled();
  });
});

describe("ReviewerPortalService.getDownload", () => {
  it("blocks downloads when allowDownload is false", async () => {
    await expect(
      reviewerPortalService.getDownload(INVITE_ID, false, VERSION_ID),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FORBIDDEN" });
    // Refused before any lookup, so a disabled download cannot even confirm
    // whether the version exists.
    expect(mockPrisma.reviewerInvitationDocument.findFirst).not.toHaveBeenCalled();
  });

  it("streams the original only when the founder enabled downloads", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    (storageService.readObject as jest.Mock).mockResolvedValue(Buffer.from("%PDF-1.4"));

    const result = await reviewerPortalService.getDownload(INVITE_ID, true, VERSION_ID);
    expect(result.originalFilename).toBe("deck.pdf");
    // Never a signed storage URL — the bytes go through us.
    expect(storageService.createSignedReadUrl).not.toHaveBeenCalled();
  });
});
