import { getReviewerOperationsConfig, type ReviewerOperationsConfig } from "../config/reviewer-operations";
import { prisma } from "../db/prisma";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export interface ReviewerRetentionResult {
  expiredChallengesDeleted: number;
  expiredCredentialsRedacted: number;
  sessionNetworkDataRedacted: number;
  visitNetworkDataRedacted: number;
  pageViewsDeleted: number;
  securityEventsDeleted: number;
}

/**
 * Preserve founder-facing evidence (invitations, comments and aggregate visits)
 * while removing credentials, direct network data and high-volume detail once
 * each has stopped serving its operational purpose.
 */
export async function enforceReviewerRetention(
  now = new Date(),
  config: ReviewerOperationsConfig = getReviewerOperationsConfig(),
): Promise<ReviewerRetentionResult> {
  const challengeCutoff = new Date(now.getTime() - config.challengeRetentionHours * HOUR_MS);
  const networkCutoff = new Date(now.getTime() - config.networkRetentionDays * DAY_MS);
  const engagementCutoff = new Date(now.getTime() - config.engagementRetentionDays * DAY_MS);
  const eventCutoff = new Date(now.getTime() - config.eventRetentionDays * DAY_MS);

  return prisma.$transaction(async (tx) => {
    const expiredChallenges = await tx.reviewerSession.deleteMany({
      where: {
        verifiedAt: null,
        OR: [
          { verificationExpiresAt: { lt: challengeCutoff } },
          { verificationExpiresAt: null, createdAt: { lt: challengeCutoff } },
        ],
      },
    });
    const expiredCredentials = await tx.reviewerSession.updateMany({
      where: {
        verifiedAt: { not: null },
        AND: [
          { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
          {
            OR: [
              { sessionTokenHash: { not: null } },
              { verificationCodeHash: { not: null } },
              { verificationExpiresAt: { not: null } },
            ],
          },
        ],
      },
      data: {
        sessionTokenHash: null,
        verificationCodeHash: null,
        verificationExpiresAt: null,
      },
    });
    const sessionNetworkData = await tx.reviewerSession.updateMany({
      where: {
        createdAt: { lt: networkCutoff },
        OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }],
      },
      data: { ipAddress: null, userAgent: null },
    });
    const visitNetworkData = await tx.reviewerVisit.updateMany({
      where: {
        lastSeenAt: { lt: networkCutoff },
        OR: [
          { deviceHash: { not: null } },
          { ipHash: { not: null } },
          { referrer: { not: null } },
        ],
      },
      data: { deviceHash: null, ipHash: null, referrer: null },
    });
    const pageViews = await tx.reviewerPageView.deleteMany({
      where: { lastViewedAt: { lt: engagementCutoff } },
    });
    const securityEvents = await tx.reviewerEvent.deleteMany({
      where: { createdAt: { lt: eventCutoff } },
    });

    return {
      expiredChallengesDeleted: expiredChallenges.count,
      expiredCredentialsRedacted: expiredCredentials.count,
      sessionNetworkDataRedacted: sessionNetworkData.count,
      visitNetworkDataRedacted: visitNetworkData.count,
      pageViewsDeleted: pageViews.count,
      securityEventsDeleted: securityEvents.count,
    };
  });
}
