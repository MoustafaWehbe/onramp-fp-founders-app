jest.mock("../../src/db/prisma", () => ({
  prisma: {
    reviewerSession: { findFirst: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("../../src/utils/auth", () => ({
  hashToken: jest.fn((value: string) => `hash:${value}`),
}));

import type { NextFunction, Request, Response } from "express";
import { prisma } from "../../src/db/prisma";
import { requireReviewerSession } from "../../src/middleware/reviewer-auth";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "invitation-1",
    startupId: "startup-1",
    status: "in_review",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    allowDownload: false,
    watermarkEnabled: true,
    requireNda: false,
    ndaAcceptedAt: null,
    emailNormalized: "ada@example.com",
    reviewerName: "Ada Investor",
    ...overrides,
  };
}

function requestWithCookie(token?: string) {
  return { cookies: token ? { reviewerSessionToken: token } : {} } as Request;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.reviewerSession.update.mockResolvedValue({} as never);
});

describe("requireReviewerSession", () => {
  it("hydrates a valid reviewer context from a hashed cookie", async () => {
    mockPrisma.reviewerSession.findFirst.mockResolvedValue({
      id: "session-1",
      verifiedAt: new Date(),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      invitation: invitation(),
    } as never);
    const req = requestWithCookie("raw-session-token");
    const next = jest.fn() as NextFunction;

    await requireReviewerSession(req, {} as Response, next);

    expect(mockPrisma.reviewerSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionTokenHash: "hash:raw-session-token" } }),
    );
    expect(req.reviewer).toMatchObject({
      sessionId: "session-1",
      invitationId: "invitation-1",
      startupId: "startup-1",
      email: "ada@example.com",
    });
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects an expired session before recording access", async () => {
    mockPrisma.reviewerSession.findFirst.mockResolvedValue({
      id: "session-1",
      verifiedAt: new Date(),
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
      invitation: invitation(),
    } as never);
    const next = jest.fn() as NextFunction;

    await requireReviewerSession(requestWithCookie("expired"), {} as Response, next);

    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "SESSION_EXPIRED", statusCode: 401 });
    expect(mockPrisma.reviewerSession.update).not.toHaveBeenCalled();
  });

  it("does not write an access heartbeat for every page request", async () => {
    mockPrisma.reviewerSession.findFirst.mockResolvedValue({
      id: "session-1",
      verifiedAt: new Date(),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      accessedAt: new Date(),
      invitation: invitation(),
    } as never);

    await requireReviewerSession(requestWithCookie("recent"), {} as Response, jest.fn());

    expect(mockPrisma.reviewerSession.update).not.toHaveBeenCalled();
  });

  it("invalidates an otherwise-live session immediately when its invitation is revoked", async () => {
    mockPrisma.reviewerSession.findFirst.mockResolvedValue({
      id: "session-1",
      verifiedAt: new Date(),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      invitation: invitation({ status: "revoked", revokedAt: new Date() }),
    } as never);
    const next = jest.fn() as NextFunction;

    await requireReviewerSession(requestWithCookie("revoked"), {} as Response, next);

    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "INVITATION_INACTIVE", statusCode: 403 });
    expect(mockPrisma.reviewerSession.update).not.toHaveBeenCalled();
  });

  it("does not query the database when the reviewer cookie is absent", async () => {
    const next = jest.fn() as NextFunction;
    await requireReviewerSession(requestWithCookie(), {} as Response, next);

    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "UNAUTHORIZED", statusCode: 401 });
    expect(mockPrisma.reviewerSession.findFirst).not.toHaveBeenCalled();
  });
});
