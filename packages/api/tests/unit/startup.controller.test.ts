import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../app";

jest.mock("../../src/middleware/rate-limiter", () => ({
  rateLimiter: (_req: any, _res: any, next: any) => next(),
  authRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupMember: { findUnique: jest.fn() },
    rolePermission: { findFirst: jest.fn() },
  },
}));

jest.mock("../../src/services/startup.service", () => ({
  startupService: {
    createStartup: jest.fn(),
    getStartup: jest.fn(),
    updateStartup: jest.fn(),
    deleteStartup: jest.fn(),
    listMembers: jest.fn(),
  },
}));

import { prisma } from "../../src/db/prisma";
import { startupService } from "../../src/services/startup.service";

const mockService = startupService as jest.Mocked<typeof startupService>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const STARTUP_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000001";

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

const STARTUP = {
  id: STARTUP_ID,
  name: "Acme Corp",
  description: "AI fundraising",
  industry: "SaaS",
  website: "https://acme.example.com",
  fundingStage: "pre_seed",
  createdBy: USER_ID,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.startupMember.findUnique.mockResolvedValue(ACTIVE_MEMBER as never);
  mockPrisma.rolePermission.findFirst.mockResolvedValue({ id: "rp-1" } as never);
});

describe("GET /api/v1/startups/:startupId", () => {
  it("returns 200 with startup and caller member", async () => {
    mockService.getStartup.mockResolvedValue({
      startup: STARTUP,
      member: { id: "member-1", status: "active", role: "owner", joinedAt: new Date() },
    } as never);

    const res = await request(app)
      .get(`/api/v1/startups/${STARTUP_ID}`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(200);
    expect(res.body.data.startup.name).toBe("Acme Corp");
    expect(res.body.data.member.role).toBe("owner");
    expect(mockService.getStartup).toHaveBeenCalledWith(STARTUP_ID, USER_ID);
  });

  it("returns 401 without auth cookie", async () => {
    const res = await request(app).get(`/api/v1/startups/${STARTUP_ID}`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not an active member", async () => {
    mockPrisma.startupMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/v1/startups/${STARTUP_ID}`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("returns 400 for invalid startupId", async () => {
    const res = await request(app)
      .get("/api/v1/startups/not-a-uuid")
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/v1/startups/:startupId", () => {
  it("returns 200 with updated startup when permitted", async () => {
    mockService.updateStartup.mockResolvedValue({ ...STARTUP, name: "New Name" } as never);

    const res = await request(app)
      .patch(`/api/v1/startups/${STARTUP_ID}`)
      .set("Cookie", [accessCookie()])
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.data.startup.name).toBe("New Name");
    expect(mockService.updateStartup).toHaveBeenCalledWith(STARTUP_ID, { name: "New Name" });
  });

  it("accepts funding_stage and normalizes to fundingStage", async () => {
    mockService.updateStartup.mockResolvedValue({ ...STARTUP, fundingStage: "seed" } as never);

    const res = await request(app)
      .patch(`/api/v1/startups/${STARTUP_ID}`)
      .set("Cookie", [accessCookie()])
      .send({ funding_stage: "seed" });

    expect(res.status).toBe(200);
    expect(mockService.updateStartup).toHaveBeenCalledWith(STARTUP_ID, { fundingStage: "seed" });
  });

  it("returns 400 when body is empty", async () => {
    const res = await request(app)
      .patch(`/api/v1/startups/${STARTUP_ID}`)
      .set("Cookie", [accessCookie()])
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 403 without startup:update permission", async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/v1/startups/${STARTUP_ID}`)
      .set("Cookie", [accessCookie()])
      .send({ name: "Nope" });

    expect(res.status).toBe(403);
    expect(mockService.updateStartup).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/startups/:startupId", () => {
  it("returns 204 when permitted", async () => {
    mockService.deleteStartup.mockResolvedValue(undefined);

    const res = await request(app)
      .delete(`/api/v1/startups/${STARTUP_ID}`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(204);
    expect(mockService.deleteStartup).toHaveBeenCalledWith(STARTUP_ID);
  });

  it("returns 403 without startup:delete permission", async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/api/v1/startups/${STARTUP_ID}`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(403);
    expect(mockService.deleteStartup).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/startups/:startupId/members", () => {
  it("returns members including pending invites", async () => {
    mockService.listMembers.mockResolvedValue([
      {
        id: "m1",
        status: "active",
        role: "owner",
        joinedAt: new Date(),
        createdAt: new Date(),
        user: {
          id: USER_ID,
          firstName: "Jane",
          lastName: "Doe",
          email: "founder@example.com",
          avatarUrl: null,
        },
      },
      {
        id: "m2",
        status: "pending",
        role: "collaborator",
        joinedAt: null,
        createdAt: new Date(),
        invitedEmail: "bob@acme.example.com",
      },
    ] as never);

    const res = await request(app)
      .get(`/api/v1/startups/${STARTUP_ID}/members`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(200);
    expect(res.body.data.members).toHaveLength(2);
    expect(res.body.data.members[0].user.firstName).toBe("Jane");
    expect(res.body.data.members[1].invitedEmail).toBe("bob@acme.example.com");
  });

  it("returns 403 without team:read permission", async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/v1/startups/${STARTUP_ID}/members`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(403);
    expect(mockService.listMembers).not.toHaveBeenCalled();
  });
});
