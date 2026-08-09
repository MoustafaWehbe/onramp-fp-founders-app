import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../app";

jest.mock("../../src/middleware/rate-limiter", () => ({
  rateLimiter: (_req: any, _res: any, next: any) => next(),
  authRateLimiter: (_req: any, _res: any, next: any) => next(),
  credentialRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupMember: { findUnique: jest.fn() },
    rolePermission: { findFirst: jest.fn() },
  },
}));

jest.mock("../../src/services/pipeline.service", () => ({
  pipelineService: {
    createEntry: jest.fn(),
    listEntries: jest.fn(),
    getEntry: jest.fn(),
    updateEntry: jest.fn(),
    deleteEntry: jest.fn(),
  },
}));

import { prisma } from "../../src/db/prisma";
import { pipelineService } from "../../src/services/pipeline.service";

const mockService = pipelineService as jest.Mocked<typeof pipelineService>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const STARTUP_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000001";
const CONTACT_ID = "00000000-0000-0000-0000-000000000005";
const PIPELINE_ID = "00000000-0000-0000-0000-000000000006";
const BASE = `/api/v1/startups/${STARTUP_ID}/pipeline`;

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

describe("POST /api/v1/startups/:startupId/pipeline", () => {
  it("returns 201 and passes the startup scope to the service", async () => {
    mockService.createEntry.mockResolvedValue({ id: PIPELINE_ID } as never);

    const res = await request(app)
      .post(BASE)
      .set("Cookie", [accessCookie()])
      .send({
        investorId: CONTACT_ID,
        stage: "sourced",
        expectedAmount: 100000,
        probabilityPercentage: 25,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(PIPELINE_ID);
    expect(mockService.createEntry).toHaveBeenCalledWith(
      STARTUP_ID,
      expect.objectContaining({
        investorId: CONTACT_ID,
        stage: "sourced",
        expectedAmount: 100000,
        probabilityPercentage: 25,
      }),
    );
  });

  it("returns 401 without an auth cookie", async () => {
    const res = await request(app)
      .post(BASE)
      .send({ investorId: CONTACT_ID, stage: "sourced" });
    expect(res.status).toBe(401);
    expect(mockService.createEntry).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not an active member", async () => {
    mockPrisma.startupMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(BASE)
      .set("Cookie", [accessCookie()])
      .send({ investorId: CONTACT_ID, stage: "sourced" });

    expect(res.status).toBe(403);
    expect(mockService.createEntry).not.toHaveBeenCalled();
  });

  it("returns 403 when the role lacks pipeline:create", async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post(BASE)
      .set("Cookie", [accessCookie()])
      .send({ investorId: CONTACT_ID, stage: "sourced" });

    expect(res.status).toBe(403);
    expect(mockService.createEntry).not.toHaveBeenCalled();
  });

  it("rejects an invalid stage before calling the service", async () => {
    const res = await request(app)
      .post(BASE)
      .set("Cookie", [accessCookie()])
      .send({ investorId: CONTACT_ID, stage: "prospect" });

    expect(res.status).toBe(400);
    expect(mockService.createEntry).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/startups/:startupId/pipeline", () => {
  it("returns 200 with list payload and forwards query filters", async () => {
    mockService.listEntries.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    } as never);

    const res = await request(app)
      .get(`${BASE}?page=1&limit=20&stage=due_diligence`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
    expect(mockService.listEntries).toHaveBeenCalledWith(
      STARTUP_ID,
      expect.objectContaining({ page: 1, limit: 20, stage: "due_diligence" }),
    );
  });
});

describe("GET /api/v1/startups/:startupId/pipeline/:pipelineId", () => {
  it("returns 200 for a tenant-scoped entry", async () => {
    mockService.getEntry.mockResolvedValue({ id: PIPELINE_ID } as never);

    const res = await request(app)
      .get(`${BASE}/${PIPELINE_ID}`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(200);
    expect(mockService.getEntry).toHaveBeenCalledWith(STARTUP_ID, PIPELINE_ID);
  });
});

describe("PATCH /api/v1/startups/:startupId/pipeline/:pipelineId", () => {
  it("returns 200 and forwards the body", async () => {
    mockService.updateEntry.mockResolvedValue({ id: PIPELINE_ID, stage: "committed" } as never);

    const res = await request(app)
      .patch(`${BASE}/${PIPELINE_ID}`)
      .set("Cookie", [accessCookie()])
      .send({ stage: "committed", probabilityPercentage: 90 });

    expect(res.status).toBe(200);
    expect(mockService.updateEntry).toHaveBeenCalledWith(
      STARTUP_ID,
      PIPELINE_ID,
      expect.objectContaining({ stage: "committed", probabilityPercentage: 90 }),
    );
  });

  it("rejects an empty body", async () => {
    const res = await request(app)
      .patch(`${BASE}/${PIPELINE_ID}`)
      .set("Cookie", [accessCookie()])
      .send({});

    expect(res.status).toBe(400);
    expect(mockService.updateEntry).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/startups/:startupId/pipeline/:pipelineId", () => {
  it("returns 200 with the removal message", async () => {
    mockService.deleteEntry.mockResolvedValue(undefined as never);

    const res = await request(app)
      .delete(`${BASE}/${PIPELINE_ID}`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Pipeline entry removed");
    expect(mockService.deleteEntry).toHaveBeenCalledWith(STARTUP_ID, PIPELINE_ID);
  });

  it("returns 403 when the role lacks pipeline:delete", async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete(`${BASE}/${PIPELINE_ID}`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(403);
    expect(mockService.deleteEntry).not.toHaveBeenCalled();
  });
});
