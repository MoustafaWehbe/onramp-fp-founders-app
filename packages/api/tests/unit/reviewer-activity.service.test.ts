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
      reviewerActivityService.list(STARTUP_ID, INVITATION_ID, 50),
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

    const result = await reviewerActivityService.list(STARTUP_ID, INVITATION_ID, 50);

    expect(result[0]).toMatchObject({
      type: "comment_added",
      document: { id: "document-1", versionId: "version-2" },
      pageNumber: 8,
    });
    expect(result[1]).toMatchObject({ type: "page_viewed", pageNumber: 8 });
    expect(mockPrisma.reviewerPageView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { visit: { invitationId: INVITATION_ID } } }),
    );
  });
});
