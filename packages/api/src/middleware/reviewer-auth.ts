import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { hashToken } from "../utils/auth";

export type ReviewerAuthContext = {
  sessionId: string;
  invitationId: string;
  startupId: string;
  allowDownload: boolean;
  watermarkEnabled: boolean;
  requireNda: boolean;
  ndaAccepted: boolean;
  email: string;
  reviewerName: string | null;
};

declare global {
  namespace Express {
    interface Request {
      reviewer?: ReviewerAuthContext;
    }
  }
}

export async function requireReviewerSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const raw = req.cookies?.reviewerSessionToken as string | undefined;
    if (!raw) throw createError("Reviewer session required", 401, "UNAUTHORIZED");

    const session = await prisma.reviewerSession.findFirst({
      where: { sessionTokenHash: hashToken(raw) },
      include: {
        invitation: {
          select: {
            id: true,
            startupId: true,
            status: true,
            expiresAt: true,
            revokedAt: true,
            allowDownload: true,
            watermarkEnabled: true,
            requireNda: true,
            ndaAcceptedAt: true,
            emailNormalized: true,
            reviewerName: true,
          },
        },
      },
    });

    if (!session || session.revokedAt || !session.verifiedAt) {
      throw createError("Reviewer session invalid", 401, "UNAUTHORIZED");
    }
    if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
      throw createError("Reviewer session expired", 401, "SESSION_EXPIRED");
    }

    const invitation = session.invitation;
    if (
      invitation.revokedAt ||
      invitation.status === "revoked" ||
      invitation.expiresAt.getTime() < Date.now()
    ) {
      throw createError("Invitation is no longer valid", 403, "INVITATION_INACTIVE");
    }

    req.reviewer = {
      sessionId: session.id,
      invitationId: invitation.id,
      startupId: invitation.startupId,
      allowDownload: invitation.allowDownload,
      watermarkEnabled: invitation.watermarkEnabled,
      requireNda: invitation.requireNda,
      ndaAccepted: invitation.ndaAcceptedAt !== null,
      email: invitation.emailNormalized,
      reviewerName: invitation.reviewerName,
    };

    // Page navigation can call this middleware many times in a minute. Keep
    // accessedAt useful as a heartbeat without turning every rendered page
    // read into a PostgreSQL write.
    const accessWriteIntervalMs = 60_000;
    if (!session.accessedAt || session.accessedAt.getTime() < Date.now() - accessWriteIntervalMs) {
      await prisma.reviewerSession.update({
        where: { id: session.id },
        data: { accessedAt: new Date() },
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}
