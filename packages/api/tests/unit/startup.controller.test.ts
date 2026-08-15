import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../app";

jest.mock("../../src/middleware/rate-limiter", () => ({
  rateLimiter: (_req: any, _res: any, next: any) => next(),
  authRateLimiter: (_req: any, _res: any, next: any) => next(),
  credentialRateLimiter: (_req: any, _res: any, next: any) => next(),
  emailSendRateLimiter: (_req: any, _res: any, next: any) => next(),
  scheduleMeetingRateLimiter: (_req: any, _res: any, next: any) => next(),
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
    listRoles: jest.fn(),
    listMyStartups: jest.fn(),
    setActiveStartup: jest.fn(),
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

describe("PUT /api/v1/startups/:startupId/activate", () => {
  it("records the active workspace and answers 204", async () => {
    mockService.setActiveStartup.mockResolvedValue(undefined);

    const res = await request(app)
      .put(`/api/v1/startups/${STARTUP_ID}/activate`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(204);
    expect(mockService.setActiveStartup).toHaveBeenCalledWith(STARTUP_ID, USER_ID);
  });

  it("refuses for someone who is not an active member", async () => {
    // Guarded by requireMember alone any role may switch into a workspace
    // they belong to, so no extra permission is required.
    mockPrisma.startupMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put(`/api/v1/startups/${STARTUP_ID}/activate`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(403);
    expect(mockService.setActiveStartup).not.toHaveBeenCalled();
  });

  it("returns 401 without an auth cookie", async () => {
    const res = await request(app).put(`/api/v1/startups/${STARTUP_ID}/activate`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/startups", () => {
  it("returns the caller's workspaces", async () => {
    mockService.listMyStartups.mockResolvedValue([
      { ...STARTUP, member: { id: "m1", status: "active", role: "owner", joinedAt: null } },
    ] as never);

    const res = await request(app).get("/api/v1/startups").set("Cookie", [accessCookie()]);

    expect(res.status).toBe(200);
    expect(res.body.data.startups).toHaveLength(1);
    expect(res.body.data.startups[0].member.role).toBe("owner");
    expect(mockService.listMyStartups).toHaveBeenCalledWith(USER_ID);
  });

  it("returns 200 with an empty list rather than 403 for a user with no workspace", async () => {
    // This is the signal the client uses to route someone to onboarding, so it
    // must not be conflated with a permission failure.
    mockService.listMyStartups.mockResolvedValue([] as never);

    const res = await request(app).get("/api/v1/startups").set("Cookie", [accessCookie()]);

    expect(res.status).toBe(200);
    expect(res.body.data.startups).toEqual([]);
  });

  it("returns 401 without an auth cookie", async () => {
    const res = await request(app).get("/api/v1/startups");
    expect(res.status).toBe(401);
    expect(mockService.listMyStartups).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/startups/:startupId/roles", () => {
  it("returns the startup's assignable roles", async () => {
    mockService.listRoles.mockResolvedValue([
      { id: "role-owner", name: "owner", description: "Full access", isSystemRole: true },
      { id: "role-viewer", name: "viewer", description: "Read-only", isSystemRole: true },
    ] as never);

    const res = await request(app)
      .get(`/api/v1/startups/${STARTUP_ID}/roles`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(200);
    expect(res.body.data.roles).toHaveLength(2);
    expect(res.body.data.roles[0].name).toBe("owner");
  });

  it("returns 403 without team:read permission", async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/v1/startups/${STARTUP_ID}/roles`)
      .set("Cookie", [accessCookie()]);

    expect(res.status).toBe(403);
    expect(mockService.listRoles).not.toHaveBeenCalled();
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
