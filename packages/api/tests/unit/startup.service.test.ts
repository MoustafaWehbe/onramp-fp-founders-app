import { StartupService } from "../../src/services/startup.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startup: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    startupMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    role: {
      findMany: jest.fn(),
    },
    user: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { prisma } from "../../src/db/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const service = new StartupService();

const STARTUP_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000001";

const STARTUP = {
  id: STARTUP_ID,
  name: "Acme Corp",
  description: "AI fundraising",
  industry: "SaaS",
  website: "https://acme.example.com",
  fundingStage: "pre_seed",
  createdBy: USER_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("StartupService.getStartup", () => {
  it("returns startup and caller member with role name", async () => {
    mockPrisma.startup.findUnique.mockResolvedValue(STARTUP as never);
    mockPrisma.startupMember.findUnique.mockResolvedValue({
      id: "member-1",
      status: "active",
      joinedAt: new Date("2026-01-01"),
      role: { name: "owner" },
    } as never);

    const result = await service.getStartup(STARTUP_ID, USER_ID);

    expect(result.startup.name).toBe("Acme Corp");
    expect(result.member.role).toBe("owner");
  });

  it("throws 404 when startup is missing", async () => {
    mockPrisma.startup.findUnique.mockResolvedValue(null);

    await expect(service.getStartup(STARTUP_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
  });

  it("throws 403 when membership is not active", async () => {
    mockPrisma.startup.findUnique.mockResolvedValue(STARTUP as never);
    mockPrisma.startupMember.findUnique.mockResolvedValue({
      id: "member-1",
      status: "pending",
      role: { name: "viewer" },
    } as never);

    await expect(service.getStartup(STARTUP_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });
  });
});

describe("StartupService.updateStartup", () => {
  it("updates and returns selected startup fields", async () => {
    mockPrisma.startup.findUnique.mockResolvedValue({ id: STARTUP_ID } as never);
    mockPrisma.startup.update.mockResolvedValue({ ...STARTUP, name: "Renamed" } as never);

    const result = await service.updateStartup(STARTUP_ID, { name: "Renamed" });

    expect(result.name).toBe("Renamed");
    expect(mockPrisma.startup.update).toHaveBeenCalledWith({
      where: { id: STARTUP_ID },
      data: { name: "Renamed" },
      select: expect.any(Object),
    });
  });

  it("throws 404 when startup does not exist", async () => {
    mockPrisma.startup.findUnique.mockResolvedValue(null);

    await expect(service.updateStartup(STARTUP_ID, { name: "X" })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("StartupService.deleteStartup", () => {
  it("clears lastActiveStartupId then deletes startup", async () => {
    mockPrisma.startup.findUnique.mockResolvedValue({ id: STARTUP_ID } as never);
    mockPrisma.$transaction.mockResolvedValue([{}, {}] as never);

    await service.deleteStartup(STARTUP_ID);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it("throws 404 when startup does not exist", async () => {
    mockPrisma.startup.findUnique.mockResolvedValue(null);

    await expect(service.deleteStartup(STARTUP_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("StartupService.setActiveStartup", () => {
  it("records the workspace against the user", async () => {
    (mockPrisma.user.update as jest.Mock).mockResolvedValue({} as never);

    await service.setActiveStartup(STARTUP_ID, USER_ID);

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { lastActiveStartupId: STARTUP_ID },
    });
  });
});

describe("StartupService.listMyStartups", () => {
  it("returns only workspaces where the caller is an active member", async () => {
    mockPrisma.startupMember.findMany.mockResolvedValue([
      {
        id: "m1",
        status: "active",
        joinedAt: new Date("2026-01-01"),
        role: { name: "owner" },
        startup: STARTUP,
      },
    ] as never);

    const result = await service.listMyStartups(USER_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: STARTUP_ID,
      name: "Acme Corp",
      member: { role: "owner", status: "active" },
    });
    // Pending invitations are not openable workspaces — they must not appear.
    expect(mockPrisma.startupMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, status: "active" } }),
    );
  });

  it("returns an empty list for a user who belongs to nothing yet", async () => {
    mockPrisma.startupMember.findMany.mockResolvedValue([] as never);
    await expect(service.listMyStartups(USER_ID)).resolves.toEqual([]);
  });
});

describe("StartupService.listRoles", () => {
  it("returns only the roles scoped to the startup, most privileged first", async () => {
    const roles = [
      { id: "role-owner", name: "owner", description: "Full access", isSystemRole: true },
      { id: "role-collab", name: "collaborator", description: "Can edit", isSystemRole: true },
      { id: "role-viewer", name: "viewer", description: "Read-only", isSystemRole: true },
    ];
    mockPrisma.role.findMany.mockResolvedValue(roles as never);

    const result = await service.listRoles(STARTUP_ID);

    expect(result).toEqual(roles);
    expect(mockPrisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId: STARTUP_ID },
        orderBy: { createdAt: "asc" },
      }),
    );
  });
});

describe("StartupService.listMembers", () => {
  it("maps active users and pending invites", async () => {
    mockPrisma.startupMember.findMany.mockResolvedValue([
      {
        id: "m1",
        status: "active",
        joinedAt: new Date(),
        createdAt: new Date(),
        userId: USER_ID,
        invitedEmail: null,
        role: { name: "owner" },
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
        joinedAt: null,
        createdAt: new Date(),
        userId: null,
        invitedEmail: "bob@acme.example.com",
        role: { name: "collaborator" },
        user: null,
      },
    ] as never);

    const result = await service.listMembers(STARTUP_ID);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      status: "active",
      role: "owner",
      user: { firstName: "Jane", email: "founder@example.com" },
    });
    expect(result[1]).toMatchObject({
      status: "pending",
      role: "collaborator",
      invitedEmail: "bob@acme.example.com",
    });
    expect(result[1]).not.toHaveProperty("user");
  });
});
