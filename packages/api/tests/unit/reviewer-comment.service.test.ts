jest.mock("../../src/db/prisma", () => ({
  prisma: {
    reviewerComment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { prisma } from "../../src/db/prisma";
import { reviewerCommentService } from "../../src/services/reviewer-comment.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => jest.clearAllMocks());

describe("ReviewerCommentService", () => {
  it("scopes unread founder comments to the startup and returns summary counts", async () => {
    mockPrisma.reviewerComment.findMany.mockResolvedValue([
      {
        id: "comment-1",
        invitationId: "invite-1",
        commentText: "Please explain the growth assumption",
        createdAt: new Date(),
        readAt: null,
        resolvedAt: null,
        invitation: {
          id: "invite-1",
          reviewerName: "Ada",
          emailNormalized: "ada@vc.test",
          documents: [{ documentId: "doc-1", documentVersionId: "version-2" }],
        },
        document: { id: "doc-1", title: "Series A deck" },
        documentVersionId: "version-2",
        chunk: {
          id: "chunk-1",
          documentVersionId: "version-2",
          sectionLabel: "Growth",
          pageNumber: 8,
        },
        resolver: null,
      },
    ] as never);
    mockPrisma.reviewerComment.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    const result = await reviewerCommentService.list("startup-1", {
      page: 1,
      limit: 20,
      status: "unread",
    });

    expect(mockPrisma.reviewerComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId: "startup-1", readAt: null, resolvedAt: null },
      }),
    );
    expect(result.meta).toMatchObject({ total: 1, unreadCount: 1, openCount: 1 });
    expect(result.data[0]).toMatchObject({ reviewerName: "Ada", commentText: expect.any(String) });
    expect(result.data[0].document).toMatchObject({ versionId: "version-2" });
  });

  it("resolves only a comment belonging to the requested startup", async () => {
    mockPrisma.reviewerComment.updateMany.mockResolvedValue({ count: 1 } as never);

    await reviewerCommentService.resolve("startup-1", "comment-1", "user-1");

    expect(mockPrisma.reviewerComment.updateMany).toHaveBeenCalledWith({
      where: { id: "comment-1", startupId: "startup-1", resolvedAt: null },
      data: {
        readAt: expect.any(Date),
        resolvedAt: expect.any(Date),
        resolvedBy: "user-1",
      },
    });
  });
});
