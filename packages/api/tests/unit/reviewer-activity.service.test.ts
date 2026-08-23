jest.mock("../../src/db/prisma", () => ({
  prisma: {
    reviewerInvitation: { findUnique: jest.fn() },
    reviewerInvitationDocument: { findMany: jest.fn() },
    reviewerSession: { findMany: jest.fn() },
    reviewerVisit: { findMany: jest.fn() },
    reviewerPageView: { findMany: jest.fn() },
    reviewerComment: { findMany: jest.fn() },
    reviewerEvent: { findMany: jest.fn() },
  },
}));

import { prisma } from "../../src/db/prisma";
import { reviewerActivityService } from "../../src/services/reviewer-activity.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const STARTUP_ID = "startup-1";
const INVITATION_ID = "invitation-1";

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.reviewerInvitationDocument.findMany.mockResolvedValue([]);
  mockPrisma.reviewerSession.findMany.mockResolvedValue([]);
  mockPrisma.reviewerVisit.findMany.mockResolvedValue([]);
  mockPrisma.reviewerPageView.findMany.mockResolvedValue([]);
  mockPrisma.reviewerComment.findMany.mockResolvedValue([]);
  mockPrisma.reviewerEvent.findMany.mockResolvedValue([]);
});

describe("ReviewerActivityService", () => {
  it("rejects an invitation outside the requested startup", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue(null);

    await expect(
      reviewerActivityService.list(STARTUP_ID, INVITATION_ID, { limit: 50 }),
    ).rejects.toMatchObject({ code: "INVITATION_NOT_FOUND" });
    expect(mockPrisma.reviewerInvitation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId_id: { startupId: STARTUP_ID, id: INVITATION_ID } },
      }),
    );
  });

  it("sorts activity and keeps page links pinned to the reviewed version", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      id: INVITATION_ID,
      createdAt: new Date("2026-08-20T09:00:00Z"),
      deliverySentAt: new Date("2026-08-20T09:05:00Z"),
      completedAt: null,
      revokedAt: null,
    } as never);
    mockPrisma.reviewerInvitationDocument.findMany.mockResolvedValue([
      {
        documentId: "document-1",
        documentVersionId: "version-2",
        document: { title: "Series A deck" },
      },
    ] as never);
    mockPrisma.reviewerPageView.findMany.mockResolvedValue([
      {
        id: "page-view-1",
        documentVersionId: "version-2",
        pageNumber: 8,
        firstViewedAt: new Date("2026-08-20T10:00:00Z"),
        activeMs: 12_000,
        viewCount: 2,
      },
    ] as never);
    mockPrisma.reviewerComment.findMany.mockResolvedValue([
      {
        id: "comment-1",
        documentId: "document-1",
        documentVersionId: "version-2",
        commentText: "Explain the growth assumption",
        createdAt: new Date("2026-08-20T10:05:00Z"),
        chunk: { documentVersionId: "version-2", pageNumber: 8, sectionLabel: "Growth" },
      },
    ] as never);

    const result = await reviewerActivityService.list(STARTUP_ID, INVITATION_ID, { limit: 50 });

    expect(result.data[0]).toMatchObject({
      type: "comment_added",
      document: { id: "document-1", versionId: "version-2" },
      pageNumber: 8,
    });
    expect(result.data[1]).toMatchObject({ type: "page_viewed", pageNumber: 8 });
    expect(result.pagination).toEqual({ hasMore: false, nextCursor: null });
    expect(mockPrisma.reviewerPageView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { visit: { invitationId: INVITATION_ID } } }),
    );
  });

  it("returns an opaque cursor and excludes already delivered activity", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      id: INVITATION_ID,
      createdAt: new Date("2026-08-20T09:00:00Z"),
      deliverySentAt: null,
      completedAt: null,
      revokedAt: null,
    } as never);
    mockPrisma.reviewerEvent.findMany.mockResolvedValue([
      {
        id: "event-3",
        type: "copy_attempt",
        documentVersionId: null,
        pageNumber: null,
        createdAt: new Date("2026-08-20T12:00:00Z"),
      },
      {
        id: "event-2",
        type: "print_attempt",
        documentVersionId: null,
        pageNumber: null,
        createdAt: new Date("2026-08-20T11:00:00Z"),
      },
    ] as never);

    const firstPage = await reviewerActivityService.list(STARTUP_ID, INVITATION_ID, { limit: 1 });
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.pagination.hasMore).toBe(true);
    expect(firstPage.pagination.nextCursor).toEqual(expect.any(String));

    mockPrisma.reviewerEvent.findMany.mockResolvedValue([
      {
        id: "event-2",
        type: "print_attempt",
        documentVersionId: null,
        pageNumber: null,
        createdAt: new Date("2026-08-20T11:00:00Z"),
      },
    ] as never);
    const secondPage = await reviewerActivityService.list(STARTUP_ID, INVITATION_ID, {
      limit: 1,
      cursor: firstPage.pagination.nextCursor!,
    });

    expect(secondPage.data[0]).toMatchObject({ id: "security-event-event-2" });
    expect(mockPrisma.reviewerEvent.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { lte: new Date("2026-08-20T12:00:00Z") },
        }),
      }),
    );
  });

  it("rejects a malformed activity cursor", async () => {
    mockPrisma.reviewerInvitation.findUnique.mockResolvedValue({
      id: INVITATION_ID,
      createdAt: new Date("2026-08-20T09:00:00Z"),
      deliverySentAt: null,
      completedAt: null,
      revokedAt: null,
    } as never);
    await expect(
      reviewerActivityService.list(STARTUP_ID, INVITATION_ID, {
        limit: 25,
        cursor: Buffer.from("not-json").toString("base64url"),
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_ACTIVITY_CURSOR" });
  });
});
