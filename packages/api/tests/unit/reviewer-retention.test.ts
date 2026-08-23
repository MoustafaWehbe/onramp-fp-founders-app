const transaction = jest.fn();
const reviewerSessionDeleteMany = jest.fn();
const reviewerSessionUpdateMany = jest.fn();
const reviewerVisitUpdateMany = jest.fn();
const reviewerPageViewDeleteMany = jest.fn();
const reviewerEventDeleteMany = jest.fn();

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

import { enforceReviewerRetention } from "../../src/jobs/reviewer-retention";

const config = {
  challengeRetentionHours: 24,
  networkRetentionDays: 30,
  engagementRetentionDays: 365,
  eventRetentionDays: 180,
  metricsEnabled: false,
  metricsToken: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  reviewerSessionDeleteMany.mockResolvedValue({ count: 1 });
  reviewerSessionUpdateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 3 });
  reviewerVisitUpdateMany.mockResolvedValue({ count: 4 });
  reviewerPageViewDeleteMany.mockResolvedValue({ count: 5 });
  reviewerEventDeleteMany.mockResolvedValue({ count: 6 });
  transaction.mockImplementation((callback) => callback({
    reviewerSession: {
      deleteMany: reviewerSessionDeleteMany,
      updateMany: reviewerSessionUpdateMany,
    },
    reviewerVisit: { updateMany: reviewerVisitUpdateMany },
    reviewerPageView: { deleteMany: reviewerPageViewDeleteMany },
    reviewerEvent: { deleteMany: reviewerEventDeleteMany },
  }));
});

describe("enforceReviewerRetention", () => {
  it("redacts privacy-sensitive detail without deleting durable reviewer history", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");

    const result = await enforceReviewerRetention(now, config);

    expect(result).toEqual({
      expiredChallengesDeleted: 1,
      expiredCredentialsRedacted: 2,
      sessionNetworkDataRedacted: 3,
      visitNetworkDataRedacted: 4,
      pageViewsDeleted: 5,
      securityEventsDeleted: 6,
    });
    expect(reviewerSessionDeleteMany).toHaveBeenCalledWith({
      where: {
        verifiedAt: null,
        OR: [
          { verificationExpiresAt: { lt: new Date("2026-08-22T12:00:00.000Z") } },
          {
            verificationExpiresAt: null,
            createdAt: { lt: new Date("2026-08-22T12:00:00.000Z") },
          },
        ],
      },
    });
    expect(reviewerSessionUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { ipAddress: null, userAgent: null } }),
    );
    expect(reviewerVisitUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deviceHash: null, ipHash: null, referrer: null } }),
    );
    // Invitations, comments and aggregate visits have no delete operation here.
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
