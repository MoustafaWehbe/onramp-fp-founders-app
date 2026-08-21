import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    refreshToken: { findFirst: jest.fn() },
  },
}));

import { prisma } from "../../src/db/prisma";
import { authenticate, optionalAuthenticate } from "../../src/middleware/auth";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const USER_ID = "00000000-0000-0000-0000-000000000001";
const SESSION_ID = "session-1";

function requestWithAccessToken(): Request {
  const accessToken = jwt.sign(
    { sub: USER_ID, type: "access", sessionId: SESSION_ID, email: "founder@example.com" },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "15m" },
  );

  return { cookies: { accessToken } } as Request;
}

function response(): Response {
  const res = {
    clearCookie: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

describe("authentication session validation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("accepts an access token only when its refresh-token family is active", async () => {
    mockPrisma.refreshToken.findFirst.mockResolvedValue({ id: "token-1" } as never);
    const req = requestWithAccessToken();
    const res = response();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(req.user).toMatchObject({ userId: USER_ID, sessionId: SESSION_ID });
    expect(mockPrisma.refreshToken.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        familyId: SESSION_ID,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: { id: true },
    });
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects and clears a still-signed access token after its session is deleted", async () => {
    mockPrisma.refreshToken.findFirst.mockResolvedValue(null);
    const req = requestWithAccessToken();
    const res = response();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.clearCookie).toHaveBeenCalledWith("accessToken", { path: "/api/v1" });
    expect(res.clearCookie).toHaveBeenCalledWith("refreshToken", { path: "/api/v1/auth/refresh" });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not expose a user from a revoked session to optional-auth routes", async () => {
    mockPrisma.refreshToken.findFirst.mockResolvedValue(null);
    const req = requestWithAccessToken();
    const next = jest.fn() as NextFunction;

    await optionalAuthenticate(req, {} as Response, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});
