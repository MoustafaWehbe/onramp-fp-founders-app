import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../app";

jest.mock("../../src/middleware/rate-limiter", () => ({
  rateLimiter: (_req: any, _res: any, next: any) => next(),
  authRateLimiter: (_req: any, _res: any, next: any) => next(),
  credentialRateLimiter: (_req: any, _res: any, next: any) => next(),
  emailSendRateLimiter: (_req: any, _res: any, next: any) => next(),
  scheduleMeetingRateLimiter: (_req: any, _res: any, next: any) => next(),
  reviewerAccessRateLimiter: (_req: any, _res: any, next: any) => next(),
  reviewerEventRateLimiter: (_req: any, _res: any, next: any) => next(),
  reviewerTelemetryRateLimiter: (_req: any, _res: any, next: any) => next(),
  reviewerContentRateLimiter: (_req: any, _res: any, next: any) => next(),
  reviewerDownloadRateLimiter: (_req: any, _res: any, next: any) => next(),
  reviewerCommentRateLimiter: (_req: any, _res: any, next: any) => next(),
  aiMessageRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    refreshToken: { findFirst: jest.fn().mockResolvedValue({ id: "session-1" }) },
    startupMember: { findUnique: jest.fn() },
    rolePermission: { findFirst: jest.fn() },
  },
}));

jest.mock("../../src/services/investor.service", () => ({
  investorService: {
    createInvestor: jest.fn(),
    listInvestors: jest.fn(),
    getInvestor: jest.fn(),
    updateInvestor: jest.fn(),
    deleteInvestor: jest.fn(),
  },
}));

import { prisma } from "../../src/db/prisma";
import { investorService } from "../../src/services/investor.service";

const mockService = investorService as jest.Mocked<typeof investorService>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const STARTUP_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000001";
const CONTACT_ID = "00000000-0000-0000-0000-000000000005";
const BASE = `/api/v1/startups/${STARTUP_ID}/investors`;

function accessCookie(userId = USER_ID, sessionId = "session-1"): string {
  const token = jwt.sign(
    { sub: userId, type: "access", sessionId, email: "founder@example.com" },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "15m" },
  );
  return `accessToken=${token}`;
}

const ACTIVE_MEMBER = {
  id: "member-1",
  userId: USER_ID,
  startupId: STARTUP_ID,
  roleId: "role-owner",
  status: "active",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.startupMember.findUnique.mockResolvedValue(ACTIVE_MEMBER as never);
  mockPrisma.rolePermission.findFirst.mockResolvedValue({ id: "rp-1" } as never);
});

describe("POST /api/v1/startups/:startupId/investors", () => {
  it("returns 201 and passes the startup scope to the service", async () => {
    mockService.createInvestor.mockResolvedValue({ id: CONTACT_ID } as never);

    const res = await request(app)
      .post(BASE)
      .set("Cookie", [accessCookie()])
      .send({ fullName: "Ada Lovelace", email: "ada@example.com" });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(CONTACT_ID);
    expect(mockService.createInvestor).toHaveBeenCalledWith(
      STARTUP_ID,
      expect.objectContaining({ fullName: "Ada Lovelace", email: "ada@example.com" }),
    );
  });

  it("returns 401 without an auth cookie", async () => {
    const res = await request(app).post(BASE).send({ fullName: "Ada" });
    expect(res.status).toBe(401);
    expect(mockService.createInvestor).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not an active member", async () => {
    mockPrisma.startupMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(BASE)
      .set("Cookie", [accessCookie()])
      .send({ fullName: "Ada" });

    expect(res.status).toBe(403);
    expect(mockService.createInvestor).not.toHaveBeenCalled();
  });

  it("returns 403 when the role lacks pipeline:create", async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post(BASE)
      .set("Cookie", [accessCookie()])
      .send({ fullName: "Ada" });

    expect(res.status).toBe(403);
    expect(mockService.createInvestor).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body", async () => {
    const res = await request(app)
      .post(BASE)
      .set("Cookie", [accessCookie()])
      .send({ fullName: "A" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(mockService.createInvestor).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID startupId", async () => {
    const res = await request(app)
      .post("/api/v1/startups/not-a-uuid/investors")
      .set("Cookie", [accessCookie()])
      .send({ fullName: "Ada" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/startups/:startupId/investors", () => {
  it("returns the paginated envelope from the service", async () => {
    mockService.listInvestors.mockResolvedValue({
      data: [{ id: CONTACT_ID, fullName: "Ada", pipeline: null, nextFollowupDate: null }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    } as never);

    const res = await request(app).get(BASE).set("Cookie", [accessCookie()]);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].fullName).toBe("Ada");
  });

  it("forwards validated and coerced query params", async () => {
    mockService.listInvestors.mockResolvedValue({ data: [], meta: {} } as never);

    await request(app)
      .get(`${BASE}?page=2&limit=5&search=accel&investorType=vc&stage=term_sheet`)
      .set("Cookie", [accessCookie()]);

    expect(mockService.listInvestors).toHaveBeenCalledWith(
      STARTUP_ID,
      expect.objectContaining({
        page: 2,
        limit: 5,
        search: "accel",
        investorType: "vc",
        stage: "term_sheet",
      }),
    );
  });

  it("returns 400 for an out-of-range limit", async () => {
    const res = await request(app).get(`${BASE}?limit=500`).set("Cookie", [accessCookie()]);

    expect(res.status).toBe(400);
    expect(mockService.listInvestors).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/startups/:startupId/investors/:investorId", () => {
  it("passes both ids to the service", async () => {
    mockService.getInvestor.mockResolvedValue({ id: CONTACT_ID } as never);

    const res = await request(app).get(`${BASE}/${CONTACT_ID}`).set("Cookie", [accessCookie()]);

    expect(res.status).toBe(200);
    expect(mockService.getInvestor).toHaveBeenCalledWith(STARTUP_ID, CONTACT_ID);
  });

  it("surfaces the service 404 as a 404", async () => {
    const err = Object.assign(new Error("Investor contact not found"), {
      statusCode: 404,
      code: "INVESTOR_NOT_FOUND",
      isOperational: true,
    });
    mockService.getInvestor.mockRejectedValue(err);

    const res = await request(app).get(`${BASE}/${CONTACT_ID}`).set("Cookie", [accessCookie()]);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("INVESTOR_NOT_FOUND");
  });

  it("returns 400 for a non-UUID investorId", async () => {
    const res = await request(app).get(`${BASE}/not-a-uuid`).set("Cookie", [accessCookie()]);

    expect(res.status).toBe(400);
    expect(mockService.getInvestor).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/startups/:startupId/investors/:investorId", () => {
  it("returns 200 with the updated contact", async () => {
    mockService.updateInvestor.mockResolvedValue({ id: CONTACT_ID, notes: "warm" } as never);

    const res = await request(app)
      .patch(`${BASE}/${CONTACT_ID}`)
      .set("Cookie", [accessCookie()])
      .send({ notes: "warm" });

    expect(res.status).toBe(200);
    // The caller's id travels with the update so the service can stamp note
    // authorship; it is never taken from the body.
    expect(mockService.updateInvestor).toHaveBeenCalledWith(
      STARTUP_ID,
      CONTACT_ID,
      expect.objectContaining({ notes: "warm" }),
      USER_ID,
    );
  });

  it("returns 400 for an empty body", async () => {
    const res = await request(app)
      .patch(`${BASE}/${CONTACT_ID}`)
      .set("Cookie", [accessCookie()])
      .send({});

    expect(res.status).toBe(400);
    expect(mockService.updateInvestor).not.toHaveBeenCalled();
  });

  it("surfaces a duplicate-email conflict as 409", async () => {
    const err = Object.assign(new Error("This startup already has a contact with that email"), {
      statusCode: 409,
      code: "DUPLICATE_EMAIL",
      isOperational: true,
    });
    mockService.updateInvestor.mockRejectedValue(err);

    const res = await request(app)
      .patch(`${BASE}/${CONTACT_ID}`)
      .set("Cookie", [accessCookie()])
      .send({ email: "taken@example.com" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_EMAIL");
  });
});

describe("DELETE /api/v1/startups/:startupId/investors/:investorId", () => {
  it("returns 200 with a confirmation message", async () => {
    mockService.deleteInvestor.mockResolvedValue(undefined as never);

    const res = await request(app).delete(`${BASE}/${CONTACT_ID}`).set("Cookie", [accessCookie()]);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Investor removed");
    expect(mockService.deleteInvestor).toHaveBeenCalledWith(STARTUP_ID, CONTACT_ID);
  });

  it("surfaces the dependents conflict as 409", async () => {
    const err = Object.assign(new Error("has dependents"), {
      statusCode: 409,
      code: "HAS_DEPENDENTS",
      isOperational: true,
    });
    mockService.deleteInvestor.mockRejectedValue(err);

    const res = await request(app).delete(`${BASE}/${CONTACT_ID}`).set("Cookie", [accessCookie()]);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("HAS_DEPENDENTS");
  });

  it("returns 403 when the role lacks pipeline:delete", async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);

    const res = await request(app).delete(`${BASE}/${CONTACT_ID}`).set("Cookie", [accessCookie()]);

    expect(res.status).toBe(403);
    expect(mockService.deleteInvestor).not.toHaveBeenCalled();
  });
});
