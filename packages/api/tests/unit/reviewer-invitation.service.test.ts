jest.mock("../../src/db/prisma", () => ({
  prisma: {
    reviewerInvitation: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    reviewerInvitationDocument: {
      findMany: jest.fn(),
    },
    reviewerVisit: {
      findMany: jest.fn(),
    },
    reviewerPageView: {
      groupBy: jest.fn(),
    },
    reviewerEvent: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    documentVersion: {
      findMany: jest.fn(),
    },
    startup: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("../../src/jobs/queue", () => ({
  emailQueue: { add: jest.fn() },
}));

jest.mock("../../src/services/audit-writer", () => ({
  recordAuditEvent: jest.fn(),
}));

import { prisma } from "../../src/db/prisma";
import { reviewerInvitationService } from "../../src/services/reviewer-invitation.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_STARTUP_ID = "00000000-0000-0000-0000-000000000002";
const INVITE_ID = "00000000-0000-0000-0000-000000000010";
const VERSION_A = "00000000-0000-0000-0000-000000000030";
const VERSION_B = "00000000-0000-0000-0000-000000000031";

function baseInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITE_ID,
    reviewerName: "Ada Investor",
    emailNormalized: "ada@vc.example",
    status: "in_review",
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    allowDownload: false,
    lastActivityAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("ReviewerInvitationService.createInvitation", () => {
  it("rejects the invitation before touching document versions when the email's domain isn't allowlisted", async () => {
    await expect(
      reviewerInvitationService.createInvitation("startup-1", "user-1", {
        email: "founder@gmail.com",
        allowedEmailDomains: ["acme.com"],
        documentVersionIds: ["00000000-0000-0000-0000-000000000030"],
        expiresInDays: 14,
      } as never),
    ).rejects.toMatchObject({ code: "EMAIL_DOMAIN_NOT_ALLOWED" });
    expect(mockPrisma.documentVersion.findMany).not.toHaveBeenCalled();
  });

  it("allows an email whose domain is in the allowlist through to the version lookup", async () => {
    mockPrisma.documentVersion.findMany.mockResolvedValue([]);

    await expect(
      reviewerInvitationService.createInvitation("startup-1", "user-1", {
        email: "investor@acme.com",
        allowedEmailDomains: ["acme.com"],
        documentVersionIds: ["00000000-0000-0000-0000-000000000030"],
        expiresInDays: 14,
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_DOCUMENT_VERSIONS" });
    expect(mockPrisma.documentVersion.findMany).toHaveBeenCalled();
  });

  it("still rejects a format LibreOffice can't convert, like XLSX", async () => {
    mockPrisma.documentVersion.findMany.mockResolvedValue([
      {
        id: VERSION_A,
        documentId: "doc-1",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        renderStatus: "unsupported",
      },
    ] as never);

    await expect(
      reviewerInvitationService.createInvitation(STARTUP_ID, "user-1", {
        email: "investor@acme.com",
        documentVersionIds: [VERSION_A],
        expiresInDays: 14,
      } as never),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_SHARE_FORMAT" });
  });

  it("allows a DOCX version through the format gate now that Phase 5 converts it", async () => {
    mockPrisma.documentVersion.findMany.mockResolvedValue([
      {
        id: VERSION_A,
        documentId: "doc-1",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        // Format gate accepts DOCX, but sharing still waits for rasterize to finish.
        renderStatus: "ready",
      },
    ] as never);
    mockPrisma.reviewerInvitation.create.mockResolvedValue({
      id: INVITE_ID,
      emailNormalized: "investor@acme.com",
      status: "pending",
      expiresAt: new Date(Date.now() + 14 * 86_400_000),
      documents: [{ id: "join-1" }],
    } as never);
    mockPrisma.startup.findUnique.mockResolvedValue({ name: "Acme" } as never);

    const result = await reviewerInvitationService.createInvitation(STARTUP_ID, "user-1", {
      email: "investor@acme.com",
      documentVersionIds: [VERSION_A],
      expiresInDays: 14,
    } as never);

    expect(result.invitation.email).toBe("investor@acme.com");
    expect(mockPrisma.reviewerInvitation.create).toHaveBeenCalled();
  });

  it("rejects a convertible DOCX that is still rendering", async () => {
    mockPrisma.documentVersion.findMany.mockResolvedValue([
      {
        id: VERSION_A,
        documentId: "doc-1",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        renderStatus: "pending",
      },
    ] as never);

    await expect(
      reviewerInvitationService.createInvitation(STARTUP_ID, "user-1", {
        email: "investor@acme.com",
        documentVersionIds: [VERSION_A],
        expiresInDays: 14,
      } as never),
    ).rejects.toMatchObject({ code: "RENDER_PENDING" });
  });
});

describe("ReviewerInvitationService.getInvitationAnalytics", () => {
  it("404s on an invitation that does not belong to this startup", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue(null);

    await expect(
      reviewerInvitationService.getInvitationAnalytics(OTHER_STARTUP_ID, INVITE_ID),
    ).rejects.toMatchObject({ code: "INVITATION_NOT_FOUND" });
    // Scoped by startupId_id in the query itself, not filtered after the fact.
    expect(mockPrisma.reviewerInvitation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId_id: { startupId: OTHER_STARTUP_ID, id: INVITE_ID } },
      }),
    );
  });

  it("returns a zeroed summary and skips the page-view query when there are no visits", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue(baseInvitation() as never);
    mockPrisma.reviewerInvitationDocument.findMany.mockResolvedValue([
      {
        document: { id: "doc-1", title: "Seed Deck" },
        documentVersion: { id: VERSION_A, pageCount: 12 },
      },
    ] as never);
    mockPrisma.reviewerVisit.findMany.mockResolvedValue([]);
    mockPrisma.reviewerEvent.groupBy.mockResolvedValue([]);
    mockPrisma.reviewerEvent.findMany.mockResolvedValue([]);

    const result = await reviewerInvitationService.getInvitationAnalytics(STARTUP_ID, INVITE_ID);

    expect(result.summary).toEqual({
      visitCount: 0,
      totalActiveMs: 0,
      lastSeenAt: null,
      completionPct: 0,
    });
    expect(result.documents).toEqual([{ documentId: "doc-1", title: "Seed Deck", versionId: VERSION_A, pageCount: 12, pages: [] }]);
    expect(mockPrisma.reviewerPageView.groupBy).not.toHaveBeenCalled();
  });

  it("buckets per-page rows by document and reduces visit rows into a summary", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue(baseInvitation() as never);
    mockPrisma.reviewerInvitationDocument.findMany.mockResolvedValue([
      { document: { id: "doc-1", title: "Deck" }, documentVersion: { id: VERSION_A, pageCount: 10 } },
      { document: { id: "doc-2", title: "Cap table" }, documentVersion: { id: VERSION_B, pageCount: 3 } },
    ] as never);

    const olderVisit = {
      id: "visit-1",
      startedAt: new Date("2026-08-14T10:00:00Z"),
      lastSeenAt: new Date("2026-08-14T10:05:00Z"),
      endedAt: new Date("2026-08-14T10:05:00Z"),
      totalActiveMs: 4_000,
      pagesViewed: 2,
      maxPageReached: 2,
      completionPct: 20,
    };
    const newerVisit = {
      id: "visit-2",
      startedAt: new Date("2026-08-16T09:00:00Z"),
      lastSeenAt: new Date("2026-08-16T09:10:00Z"),
      endedAt: null,
      totalActiveMs: 9_000,
      pagesViewed: 5,
      maxPageReached: 5,
      completionPct: 50,
    };
    mockPrisma.reviewerVisit.findMany.mockResolvedValue([newerVisit, olderVisit] as never);

    mockPrisma.reviewerPageView.groupBy.mockResolvedValue([
      { documentVersionId: VERSION_A, pageNumber: 2, _sum: { activeMs: 3_000, viewCount: 2 } },
      { documentVersionId: VERSION_A, pageNumber: 1, _sum: { activeMs: 1_000, viewCount: 1 } },
      { documentVersionId: VERSION_B, pageNumber: 1, _sum: { activeMs: 500, viewCount: 1 } },
    ] as never);
    mockPrisma.reviewerEvent.groupBy.mockResolvedValue([
      { type: "copy_attempt", _count: { _all: 3 } },
      { type: "screenshot_attempt", _count: { _all: 1 } },
    ] as never);
    mockPrisma.reviewerEvent.findMany.mockResolvedValue([] as never);

    const result = await reviewerInvitationService.getInvitationAnalytics(STARTUP_ID, INVITE_ID);

    expect(result.summary).toEqual({
      visitCount: 2,
      totalActiveMs: 13_000,
      lastSeenAt: newerVisit.lastSeenAt,
      completionPct: 50,
    });
    expect(mockPrisma.reviewerPageView.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { visitId: { in: ["visit-2", "visit-1"] } } }),
    );

    const deckPages = result.documents.find((d) => d.versionId === VERSION_A)?.pages;
    expect(deckPages).toEqual([
      { pageNumber: 1, activeMs: 1_000, viewCount: 1 },
      { pageNumber: 2, activeMs: 3_000, viewCount: 2 },
    ]);
    const capTablePages = result.documents.find((d) => d.versionId === VERSION_B)?.pages;
    expect(capTablePages).toEqual([{ pageNumber: 1, activeMs: 500, viewCount: 1 }]);

    expect(result.security.counts).toEqual({ copy_attempt: 3, screenshot_attempt: 1 });
  });

  it("summarizes distinct devices/IPs into a forwarding signal and strips the raw hashes from visits", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue(baseInvitation() as never);
    mockPrisma.reviewerInvitationDocument.findMany.mockResolvedValue([]);
    mockPrisma.reviewerVisit.findMany.mockResolvedValue([
      {
        id: "visit-1",
        startedAt: new Date(),
        lastSeenAt: new Date(),
        endedAt: null,
        totalActiveMs: 1_000,
        pagesViewed: 1,
        maxPageReached: 1,
        completionPct: 10,
        deviceType: "desktop",
        os: "macOS",
        browser: "Chrome",
        suspectedForward: true,
        deviceHash: "hash-a",
        ipHash: "ip-a",
      },
      {
        id: "visit-2",
        startedAt: new Date(),
        lastSeenAt: new Date(),
        endedAt: null,
        totalActiveMs: 1_000,
        pagesViewed: 1,
        maxPageReached: 1,
        completionPct: 10,
        deviceType: "mobile",
        os: "iOS",
        browser: "Safari",
        suspectedForward: true,
        deviceHash: "hash-b",
        ipHash: "ip-a",
      },
    ] as never);
    mockPrisma.reviewerEvent.groupBy.mockResolvedValue([]);
    mockPrisma.reviewerEvent.findMany.mockResolvedValue([]);

    const result = await reviewerInvitationService.getInvitationAnalytics(STARTUP_ID, INVITE_ID);

    expect(result.forwarding).toEqual({ distinctDevices: 2, distinctIps: 1, suspected: true });
    expect(result.visits[0]).not.toHaveProperty("deviceHash");
    expect(result.visits[0]).not.toHaveProperty("ipHash");
    expect(result.visits[0]).toMatchObject({ deviceType: "desktop", suspectedForward: true });
  });
});
