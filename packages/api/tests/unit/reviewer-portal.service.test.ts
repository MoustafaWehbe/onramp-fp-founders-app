jest.mock("../../src/db/prisma", () => ({
  prisma: {
    reviewerInvitation: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    reviewerSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    reviewerInvitationDocument: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
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
    reviewerVisit: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    reviewerPageView: {
      upsert: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn(),
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
  shortLinkId: jest.fn(() => "FPF-ABCDEF"),
}));

jest.mock("../../src/services/pdf-watermark.service", () => ({
  pdfWatermarkService: {
    watermarkPdf: jest.fn(),
  },
}));

jest.mock("../../src/services/office-convert.service", () => ({
  isOfficeConvertible: jest.fn(
    (mime: string) =>
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ),
  officeConvertService: { convertToPdf: jest.fn() },
}));

jest.mock("../../src/services/notification.service", () => ({
  notificationService: {
    notifyReviewerOpened: jest.fn(),
    notifyReviewerComment: jest.fn(),
    notifyForwardSuspected: jest.fn(),
  },
}));

jest.mock("../../src/utils/auth", () => ({
  hashToken: jest.fn((v: string) => `hash:${v}`),
  hashOTP: jest.fn((v: string) => `otp:${v}`),
  verifyOTP: jest.fn((otp: string, hash: string) => `otp:${otp}` === hash),
  generateOTP: jest.fn(() => ({ raw: "123456", hash: "otp:123456" })),
  hashForwardSignal: jest.fn((v: string) => `fwd:${v}`),
  verifyPassword: jest.fn(),
}));

jest.mock("ua-parser-js", () => ({
  // A regular `function`, not an arrow function: the service calls this with
  // `new`, and only a function that can act as a constructor supports that.
  UAParser: jest.fn().mockImplementation(function (ua: string) {
    return {
      getResult: () => ({
        device: { type: ua.includes("Mobile") ? "mobile" : undefined },
        os: { name: ua.includes("iOS") ? "iOS" : "macOS" },
        browser: { name: ua.includes("Safari") ? "Safari" : "Chrome" },
      }),
    };
  }),
}));

import { prisma } from "../../src/db/prisma";
import { emailQueue } from "../../src/jobs/queue";
import { reviewerPortalService } from "../../src/services/reviewer-portal.service";
import { officeConvertService } from "../../src/services/office-convert.service";
import { storageService } from "../../src/services/storage.service";
import { watermarkService } from "../../src/services/watermark.service";
import { pdfWatermarkService } from "../../src/services/pdf-watermark.service";
import { notificationService } from "../../src/services/notification.service";
import { verifyPassword } from "../../src/utils/auth";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const INVITE_ID = "00000000-0000-0000-0000-000000000010";
const STARTUP_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  jest.clearAllMocks();
  // Array-form $transaction: the service passes already-invoked mock
  // promises, so resolving them is enough to exercise the real code path.
  (mockPrisma.$transaction as jest.Mock).mockImplementation(
    (ops: Promise<unknown>[]) => Promise.all(ops),
  );
  // Default: a visit already exists, so getPageManifest's notifyOnOpen check
  // short-circuits without touching reviewerInvitation.findUnique. Tests
  // that specifically exercise the notification path override this.
  mockPrisma.reviewerVisit.findUnique.mockResolvedValue({ id: "existing-visit" } as never);
});

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
    expect(result.challengeId).toBe("sess-1");
    expect(emailQueue.add).toHaveBeenCalled();
    expect(mockPrisma.reviewerSession.create).toHaveBeenCalled();
  });

  it("requires a password before minting an OTP when the invitation has one set", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      id: INVITE_ID,
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      emailNormalized: "vc@example.com",
      passwordHash: "hashed-password",
      documents: [],
    } as never);

    await expect(
      reviewerPortalService.requestAccess({ token: "raw-token-value-1234567890" }, {}),
    ).rejects.toMatchObject({ code: "PASSWORD_REQUIRED" });
    expect(mockPrisma.reviewerSession.create).not.toHaveBeenCalled();
  });

  it("rejects an incorrect password before minting an OTP", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      id: INVITE_ID,
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      emailNormalized: "vc@example.com",
      passwordHash: "hashed-password",
      documents: [],
    } as never);
    (verifyPassword as jest.Mock).mockResolvedValue(false);

    await expect(
      reviewerPortalService.requestAccess(
        { token: "raw-token-value-1234567890", password: "wrong" },
        {},
      ),
    ).rejects.toMatchObject({ code: "PASSWORD_INVALID" });
    expect(mockPrisma.reviewerSession.create).not.toHaveBeenCalled();
  });

  it("proceeds to OTP once the correct password is supplied", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      id: INVITE_ID,
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      emailNormalized: "vc@example.com",
      passwordHash: "hashed-password",
      documents: [],
    } as never);
    (verifyPassword as jest.Mock).mockResolvedValue(true);
    mockPrisma.reviewerSession.create.mockResolvedValue({ id: "sess-1" } as never);
    mockPrisma.reviewerInvitation.update.mockResolvedValue({} as never);

    const result = await reviewerPortalService.requestAccess(
      { token: "raw-token-value-1234567890", password: "correct" },
      {},
    );

    expect(result.emailHint).toContain("***");
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

describe("ReviewerPortalService.verifyAccess", () => {
  const challengeId = "00000000-0000-0000-0000-000000000099";

  it("verifies only the challenge that issued the OTP", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      id: INVITE_ID,
      startupId: STARTUP_ID,
      status: "opened",
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      allowDownload: false,
      reviewerName: "Ada Investor",
      emailNormalized: "ada@example.com",
      documents: [],
    } as never);
    mockPrisma.reviewerSession.findFirst.mockResolvedValue({
      id: challengeId,
      verificationCodeHash: "otp:123456",
      verificationExpiresAt: new Date(Date.now() + 60_000),
      ipAddress: null,
      userAgent: null,
    } as never);
    mockPrisma.reviewerSession.update.mockResolvedValue({
      id: challengeId,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    mockPrisma.reviewerInvitation.update.mockResolvedValue({} as never);

    await reviewerPortalService.verifyAccess(
      { token: "raw-token-value-1234567890", challengeId, otp: "123456" },
      {},
    );

    expect(mockPrisma.reviewerSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: challengeId,
        invitationId: INVITE_ID,
        verifiedAt: null,
        revokedAt: null,
      },
    });
  });

  it("does not fall back to another pending challenge", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      id: INVITE_ID,
      status: "opened",
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      documents: [],
    } as never);
    mockPrisma.reviewerSession.findFirst.mockResolvedValue(null);

    await expect(
      reviewerPortalService.verifyAccess(
        { token: "raw-token-value-1234567890", challengeId, otp: "123456" },
        {},
      ),
    ).rejects.toMatchObject({ code: "NO_CHALLENGE" });
    expect(mockPrisma.reviewerSession.update).not.toHaveBeenCalled();
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
      STARTUP_ID,
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
      reviewerPortalService.getPageManifest(INVITE_ID, SESSION_ID, OTHER_VERSION_ID, STARTUP_ID),
    ).rejects.toMatchObject({ code: "NOT_SHARED" });
  });

  it("reports a version that has not finished rendering", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(
      pinnedVersion({ renderStatus: "rendering" }) as never,
    );

    await expect(
      reviewerPortalService.getPageManifest(INVITE_ID, SESSION_ID, VERSION_ID, STARTUP_ID),
    ).rejects.toMatchObject({ code: "RENDER_PENDING" });
  });

  it("blocks the manifest when the NDA is required but not yet accepted", async () => {
    await expect(
      reviewerPortalService.getPageManifest(INVITE_ID, SESSION_ID, VERSION_ID, STARTUP_ID, {
        requireNda: true,
        ndaAccepted: false,
      }),
    ).rejects.toMatchObject({ code: "NDA_REQUIRED" });
    // Refused before the pinned-version lookup even runs.
    expect(mockPrisma.reviewerInvitationDocument.findFirst).not.toHaveBeenCalled();
  });

  it("serves the manifest once the NDA has been accepted", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    mockPrisma.documentPage.findMany.mockResolvedValue([] as never);

    await expect(
      reviewerPortalService.getPageManifest(INVITE_ID, SESSION_ID, VERSION_ID, STARTUP_ID, {
        requireNda: true,
        ndaAccepted: true,
      }),
    ).resolves.toMatchObject({ versionId: VERSION_ID });
  });

  it("notifies the founder once per session when notifyOnOpen is enabled", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    mockPrisma.documentPage.findMany.mockResolvedValue([] as never);
    mockPrisma.reviewerVisit.findUnique.mockResolvedValue(null); // no visit yet this session
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      createdBy: "founder-1",
      notifyOnOpen: true,
      reviewerName: "Ada Investor",
      emailNormalized: "ada@vc.example",
    } as never);

    await reviewerPortalService.getPageManifest(INVITE_ID, SESSION_ID, VERSION_ID, STARTUP_ID);

    expect(notificationService.notifyReviewerOpened).toHaveBeenCalledWith({
      userId: "founder-1",
      startupId: STARTUP_ID,
      invitationId: INVITE_ID,
      reviewerLabel: "Ada Investor",
      documentTitle: "Seed Deck",
    });
  });

  it("does not notify again once a visit already exists for the session", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    mockPrisma.documentPage.findMany.mockResolvedValue([] as never);
    mockPrisma.reviewerVisit.findUnique.mockResolvedValue({ id: "visit-1" } as never);

    await reviewerPortalService.getPageManifest(INVITE_ID, SESSION_ID, VERSION_ID, STARTUP_ID);

    expect(mockPrisma.reviewerInvitation.findUnique).not.toHaveBeenCalled();
    expect(notificationService.notifyReviewerOpened).not.toHaveBeenCalled();
  });

  it("does not notify when notifyOnOpen is disabled for the invitation", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    mockPrisma.documentPage.findMany.mockResolvedValue([] as never);
    mockPrisma.reviewerVisit.findUnique.mockResolvedValue(null);
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      createdBy: "founder-1",
      notifyOnOpen: false,
      reviewerName: "Ada Investor",
      emailNormalized: "ada@vc.example",
    } as never);

    await reviewerPortalService.getPageManifest(INVITE_ID, SESSION_ID, VERSION_ID, STARTUP_ID);

    expect(notificationService.notifyReviewerOpened).not.toHaveBeenCalled();
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
      STARTUP_ID,
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

  it("blocks the page image when the NDA is required but not yet accepted", async () => {
    const token = await tokenFor(SESSION_ID, VERSION_ID);

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
        requireNda: true,
        ndaAccepted: false,
      }),
    ).rejects.toMatchObject({ code: "NDA_REQUIRED" });
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

describe("ReviewerPortalService.createComment", () => {
  it("accepts a section comment only when the chunk belongs to the pinned document version", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue({
      id: "pin-1",
      documentVersionId: VERSION_ID,
      document: { title: "Series A deck" },
    } as never);
    mockPrisma.reviewerComment.create.mockResolvedValue({ id: "comment-1" } as never);
    mockPrisma.reviewerInvitation.update.mockResolvedValue({} as never);

    await reviewerPortalService.createComment(SESSION_ID, STARTUP_ID, INVITE_ID, {
      documentId: "00000000-0000-0000-0000-000000000040",
      chunkId: "00000000-0000-0000-0000-000000000041",
      commentText: "Can you explain this assumption?",
    });

    expect(mockPrisma.reviewerInvitationDocument.findFirst).toHaveBeenCalledWith({
      where: {
        invitationId: INVITE_ID,
        documentId: "00000000-0000-0000-0000-000000000040",
        documentVersion: {
          chunks: { some: { id: "00000000-0000-0000-0000-000000000041" } },
        },
      },
      select: {
        id: true,
        documentVersionId: true,
        document: { select: { title: true } },
      },
    });
    expect(mockPrisma.reviewerComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ documentVersionId: VERSION_ID }),
    });
  });

  it("rejects a chunk that is not part of the invitation-pinned version", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(null);

    await expect(
      reviewerPortalService.createComment(SESSION_ID, STARTUP_ID, INVITE_ID, {
        documentId: "00000000-0000-0000-0000-000000000040",
        chunkId: "00000000-0000-0000-0000-000000000041",
        commentText: "Cross-document comment",
      }),
    ).rejects.toMatchObject({ code: "NOT_SHARED" });
    expect(mockPrisma.reviewerComment.create).not.toHaveBeenCalled();
  });
});

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
  function downloadInput(overrides: Record<string, unknown> = {}) {
    return {
      invitationId: INVITE_ID,
      startupId: STARTUP_ID,
      sessionId: SESSION_ID,
      allowDownload: true,
      watermarkEnabled: false,
      requireNda: false,
      ndaAccepted: true,
      versionId: VERSION_ID,
      email: "vc@example.com",
      ...overrides,
    };
  }

  it("blocks downloads when allowDownload is false", async () => {
    await expect(
      reviewerPortalService.getDownload(downloadInput({ allowDownload: false })),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FORBIDDEN" });
    // Refused before any lookup, so a disabled download cannot even confirm
    // whether the version exists.
    expect(mockPrisma.reviewerInvitationDocument.findFirst).not.toHaveBeenCalled();
  });

  it("blocks downloads when the NDA is required but not yet accepted", async () => {
    await expect(
      reviewerPortalService.getDownload(downloadInput({ requireNda: true, ndaAccepted: false })),
    ).rejects.toMatchObject({ code: "NDA_REQUIRED" });
    expect(mockPrisma.reviewerInvitationDocument.findFirst).not.toHaveBeenCalled();
  });

  it("streams the original only when the founder enabled downloads", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    (storageService.readObject as jest.Mock).mockResolvedValue(Buffer.from("%PDF-1.4"));
    mockPrisma.reviewerEvent.create.mockResolvedValue({} as never);
    mockPrisma.reviewerInvitation.update.mockResolvedValue({} as never);

    const result = await reviewerPortalService.getDownload(downloadInput());
    expect(result.originalFilename).toBe("deck.pdf");
    // Never a signed storage URL — the bytes go through us.
    expect(storageService.createSignedReadUrl).not.toHaveBeenCalled();
    expect(mockPrisma.reviewerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "download_completed" }) }),
    );
  });

  it("watermarks the PDF when the invitation has watermarking enabled", async () => {
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(pinnedVersion() as never);
    (storageService.readObject as jest.Mock).mockResolvedValue(Buffer.from("%PDF-1.4"));
    mockPrisma.reviewerEvent.create.mockResolvedValue({} as never);
    mockPrisma.reviewerInvitation.update.mockResolvedValue({} as never);
    (pdfWatermarkService.watermarkPdf as jest.Mock).mockResolvedValue(
      Buffer.from("watermarked-pdf-bytes"),
    );

    const result = await reviewerPortalService.getDownload(downloadInput({ watermarkEnabled: true }));

    expect(pdfWatermarkService.watermarkPdf).toHaveBeenCalled();
    expect(result.body.toString()).toBe("watermarked-pdf-bytes");
  });

  it("converts an Office document to a PDF before applying a download watermark", async () => {
    const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    mockPrisma.reviewerInvitationDocument.findFirst.mockResolvedValue(
      pinnedVersion({ mimeType: docxMime, originalFilename: "memo.docx" }) as never,
    );
    (storageService.readObject as jest.Mock).mockResolvedValue(Buffer.from("docx-bytes"));
    (officeConvertService.convertToPdf as jest.Mock).mockResolvedValue(Buffer.from("converted-pdf"));
    (pdfWatermarkService.watermarkPdf as jest.Mock).mockResolvedValue(Buffer.from("watermarked-pdf"));
    mockPrisma.reviewerEvent.create.mockResolvedValue({} as never);
    mockPrisma.reviewerInvitation.update.mockResolvedValue({} as never);

    const result = await reviewerPortalService.getDownload(downloadInput({ watermarkEnabled: true }));

    expect(officeConvertService.convertToPdf).toHaveBeenCalledWith(expect.any(Buffer), docxMime);
    expect(pdfWatermarkService.watermarkPdf).toHaveBeenCalledWith(
      Buffer.from("converted-pdf"),
      expect.any(String),
    );
    expect(result.mimeType).toBe("application/pdf");
    expect(result.originalFilename).toBe("memo.pdf");
  });
});

describe("ReviewerPortalService.recordTelemetry", () => {
  function pinnedForTelemetry(pageCount = 10) {
    return [{ documentVersionId: VERSION_ID, documentVersion: { pageCount } }];
  }

  it("no-ops on an empty pages array", async () => {
    await reviewerPortalService.recordTelemetry(STARTUP_ID, INVITE_ID, SESSION_ID, { pages: [] });

    expect(mockPrisma.reviewerInvitationDocument.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.reviewerVisit.upsert).not.toHaveBeenCalled();
  });

  it("drops entries for a version not pinned to this invitation", async () => {
    mockPrisma.reviewerInvitationDocument.findMany.mockResolvedValue(
      pinnedForTelemetry() as never,
    );

    await reviewerPortalService.recordTelemetry(STARTUP_ID, INVITE_ID, SESSION_ID, {
      pages: [{ documentVersionId: OTHER_VERSION_ID, pageNumber: 1, activeMs: 5000 }],
    });

    // Every entry was dropped, so there is nothing to attribute to a visit.
    expect(mockPrisma.reviewerVisit.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.reviewerPageView.upsert).not.toHaveBeenCalled();
  });

  it("clamps activeMs to the per-flush ceiling before writing", async () => {
    mockPrisma.reviewerInvitationDocument.findMany.mockResolvedValue(
      pinnedForTelemetry() as never,
    );
    mockPrisma.reviewerVisit.upsert.mockResolvedValue({ id: "visit-1" } as never);
    mockPrisma.reviewerPageView.upsert.mockResolvedValue({} as never);
    mockPrisma.reviewerPageView.count.mockResolvedValue(1 as never);
    mockPrisma.reviewerPageView.aggregate
      .mockResolvedValueOnce({ _max: { pageNumber: 1 } } as never)
      .mockResolvedValueOnce({ _sum: { activeMs: 12_000 } } as never);

    await reviewerPortalService.recordTelemetry(STARTUP_ID, INVITE_ID, SESSION_ID, {
      // Well within the schema's sanity bound (120s) but far past the
      // server's real per-flush ceiling (12s) — a hostile client shouldn't
      // be able to buy engagement by inflating a single entry.
      pages: [{ documentVersionId: VERSION_ID, pageNumber: 1, activeMs: 100_000 }],
    });

    expect(mockPrisma.reviewerPageView.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ activeMs: 12_000 }),
      }),
    );
  });

  it("upserts a visit keyed by session, and page views keyed by visit/version/page", async () => {
    mockPrisma.reviewerInvitationDocument.findMany.mockResolvedValue(
      pinnedForTelemetry() as never,
    );
    mockPrisma.reviewerVisit.upsert.mockResolvedValue({ id: "visit-1" } as never);
    mockPrisma.reviewerPageView.upsert.mockResolvedValue({} as never);
    mockPrisma.reviewerPageView.count.mockResolvedValue(2 as never);
    mockPrisma.reviewerPageView.aggregate
      .mockResolvedValueOnce({ _max: { pageNumber: 3 } } as never)
      .mockResolvedValueOnce({ _sum: { activeMs: 9_000 } } as never);

    await reviewerPortalService.recordTelemetry(STARTUP_ID, INVITE_ID, SESSION_ID, {
      pages: [{ documentVersionId: VERSION_ID, pageNumber: 3, activeMs: 4_000 }],
    });

    expect(mockPrisma.reviewerVisit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: SESSION_ID } }),
    );
    expect(mockPrisma.reviewerPageView.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          visitId_documentVersionId_pageNumber: {
            visitId: "visit-1",
            documentVersionId: VERSION_ID,
            pageNumber: 3,
          },
        },
        update: expect.objectContaining({
          activeMs: { increment: 4_000 },
          viewCount: { increment: 1 },
        }),
      }),
    );
    // Rollups are recomputed from ReviewerPageView, not accumulated in
    // place, so this reflects the mocked aggregate results above.
    expect(mockPrisma.reviewerVisit.update).toHaveBeenCalledWith({
      where: { id: "visit-1" },
      data: {
        pagesViewed: 2,
        maxPageReached: 3,
        totalActiveMs: 9_000,
        completionPct: 20, // 2 / 10 pages
      },
    });
  });
});

describe("ReviewerPortalService forwarding detection (recordTelemetry)", () => {
  function pinnedForTelemetry(pageCount = 10) {
    return [{ documentVersionId: VERSION_ID, documentVersion: { pageCount } }];
  }

  beforeEach(() => {
    mockPrisma.reviewerInvitationDocument.findMany.mockResolvedValue(
      pinnedForTelemetry() as never,
    );
    mockPrisma.reviewerPageView.upsert.mockResolvedValue({} as never);
    mockPrisma.reviewerPageView.count.mockResolvedValue(1 as never);
    mockPrisma.reviewerPageView.aggregate
      .mockResolvedValueOnce({ _max: { pageNumber: 1 } } as never)
      .mockResolvedValueOnce({ _sum: { activeMs: 1_000 } } as never);
    mockPrisma.reviewerVisit.update.mockResolvedValue({} as never);
    // First telemetry flush of a brand-new session — no visit row yet.
    mockPrisma.reviewerVisit.findUnique.mockResolvedValue(null);
    mockPrisma.reviewerSession.findUnique.mockResolvedValue({
      ipAddress: "203.0.113.9",
      userAgent: "Mozilla/5.0 (Macintosh) Safari",
    } as never);
  });

  it("does not flag or alert when only one device/IP has been seen", async () => {
    mockPrisma.reviewerVisit.upsert.mockResolvedValue({ id: "visit-1" } as never);
    mockPrisma.reviewerVisit.findMany.mockResolvedValue([
      { deviceHash: "fwd:Mozilla/5.0 (Macintosh) Safari", ipHash: "fwd:203.0.113.9" },
    ] as never);

    await reviewerPortalService.recordTelemetry(STARTUP_ID, INVITE_ID, SESSION_ID, {
      pages: [{ documentVersionId: VERSION_ID, pageNumber: 1, activeMs: 1_000 }],
    });

    expect(mockPrisma.reviewerVisit.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { suspectedForward: true } }),
    );
    expect(notificationService.notifyForwardSuspected).not.toHaveBeenCalled();
  });

  it("flags the visit and alerts the founder once a second device/IP shows up", async () => {
    mockPrisma.reviewerVisit.upsert.mockResolvedValue({ id: "visit-2" } as never);
    mockPrisma.reviewerVisit.findMany.mockResolvedValue([
      { deviceHash: "fwd:existing-ua", ipHash: "fwd:203.0.113.1" },
      { deviceHash: "fwd:Mozilla/5.0 (Macintosh) Safari", ipHash: "fwd:203.0.113.9" },
    ] as never);
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      createdBy: "founder-1",
      reviewerName: "Ada Investor",
      emailNormalized: "ada@vc.example",
    } as never);

    await reviewerPortalService.recordTelemetry(STARTUP_ID, INVITE_ID, SESSION_ID, {
      pages: [{ documentVersionId: VERSION_ID, pageNumber: 1, activeMs: 1_000 }],
    });

    expect(mockPrisma.reviewerVisit.update).toHaveBeenCalledWith({
      where: { id: "visit-2" },
      data: { suspectedForward: true },
    });
    expect(mockPrisma.reviewerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "forward_suspected" }) }),
    );
    expect(notificationService.notifyForwardSuspected).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "founder-1", invitationId: INVITE_ID }),
    );
  });

  it("skips the device/IP computation entirely when a visit already exists for the session", async () => {
    mockPrisma.reviewerVisit.findUnique.mockResolvedValue({ id: "existing-visit" } as never);
    mockPrisma.reviewerVisit.upsert.mockResolvedValue({ id: "existing-visit" } as never);

    await reviewerPortalService.recordTelemetry(STARTUP_ID, INVITE_ID, SESSION_ID, {
      pages: [{ documentVersionId: VERSION_ID, pageNumber: 1, activeMs: 1_000 }],
    });

    expect(mockPrisma.reviewerSession.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.reviewerVisit.findMany).not.toHaveBeenCalled();
  });
});

describe("ReviewerPortalService.logout", () => {
  it("revokes the session and ends any open visit for it", async () => {
    await reviewerPortalService.logout(SESSION_ID);

    expect(mockPrisma.reviewerSession.update).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mockPrisma.reviewerVisit.updateMany).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID, endedAt: null },
      data: { endedAt: expect.any(Date) },
    });
  });
});
