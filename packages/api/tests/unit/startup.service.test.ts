import { Prisma } from "@prisma/client";
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
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    permission: {
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
      role: { name: "owner", rolePermissions: [{ permission: { resource: "startup", action: "read" } }] },
    } as never);

    const result = await service.getStartup(STARTUP_ID, USER_ID);

    expect(result.startup.name).toBe("Acme Corp");
    expect(result.member.role).toBe("owner");
    expect(result.member.permissions).toEqual(["startup:read"]);
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
      role: { name: "viewer", rolePermissions: [] },
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
        role: { name: "owner", rolePermissions: [{ permission: { resource: "startup", action: "read" } }] },
        startup: STARTUP,
      },
    ] as never);

    const result = await service.listMyStartups(USER_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: STARTUP_ID,
      name: "Acme Corp",
      member: { role: "owner", status: "active", permissions: ["startup:read"] },
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
      {
        id: "role-owner",
        name: "owner",
        description: "Full access",
        isSystemRole: true,
        rolePermissions: [{ permission: { resource: "startup", action: "read" } }],
        _count: { members: 1 },
      },
      {
        id: "role-collab",
        name: "collaborator",
        description: "Can edit",
        isSystemRole: true,
        rolePermissions: [],
        _count: { members: 0 },
      },
      {
        id: "role-viewer",
        name: "viewer",
        description: "Read-only",
        isSystemRole: true,
        rolePermissions: [],
        _count: { members: 2 },
      },
    ];
    mockPrisma.role.findMany.mockResolvedValue(roles as never);

    const result = await service.listRoles(STARTUP_ID);

    expect(result).toEqual([
      { id: "role-owner", name: "owner", description: "Full access", isSystemRole: true, permissions: ["startup:read"], memberCount: 1 },
      { id: "role-collab", name: "collaborator", description: "Can edit", isSystemRole: true, permissions: [], memberCount: 0 },
      { id: "role-viewer", name: "viewer", description: "Read-only", isSystemRole: true, permissions: [], memberCount: 2 },
    ]);
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

const PERMISSION_ROWS = [
  { id: "p-financial-read", resource: "financial", action: "read" },
  { id: "p-team-create", resource: "team", action: "create" },
];

describe("StartupService.createRole", () => {
  it("creates the role and wires its permissions in one transaction", async () => {
    mockPrisma.permission.findMany.mockResolvedValue(PERMISSION_ROWS as never);
    mockPrisma.$transaction.mockImplementation(async (cb: never) =>
      (cb as (tx: unknown) => unknown)({
        role: { create: jest.fn().mockResolvedValue({ id: "role-new", name: "finance-lead", description: null }) },
        rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      }),
    );

    const result = await service.createRole(STARTUP_ID, {
      name: "finance-lead",
      permissions: ["financial:read"],
    });

    expect(result).toMatchObject({ id: "role-new", name: "finance-lead", isSystemRole: false, permissions: ["financial:read"] });
  });

  it("rejects an unknown permission key before opening a transaction", async () => {
    mockPrisma.permission.findMany.mockResolvedValue(PERMISSION_ROWS as never);

    await expect(
      service.createRole(STARTUP_ID, { name: "x", permissions: ["financial:read", "bogus:action"] }),
    ).rejects.toMatchObject({ statusCode: 400, code: "UNKNOWN_PERMISSION" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("translates a duplicate role name into ROLE_NAME_TAKEN", async () => {
    mockPrisma.permission.findMany.mockResolvedValue(PERMISSION_ROWS as never);
    mockPrisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      }),
    );

    await expect(
      service.createRole(STARTUP_ID, { name: "collaborator", permissions: ["financial:read"] }),
    ).rejects.toMatchObject({ statusCode: 409, code: "ROLE_NAME_TAKEN" });
  });
});

describe("StartupService.updateRole", () => {
  it("replaces the role's permissions and updates its description", async () => {
    mockPrisma.role.findUnique.mockResolvedValue({ id: "role-collab", startupId: STARTUP_ID, name: "collaborator" } as never);
    mockPrisma.permission.findMany.mockResolvedValue(PERMISSION_ROWS as never);
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const roleUpdate = jest.fn().mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (cb: never) =>
      (cb as (tx: unknown) => unknown)({
        role: {
          update: roleUpdate,
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: "role-collab",
            name: "collaborator",
            description: "Updated",
            isSystemRole: true,
            rolePermissions: [{ permission: { resource: "financial", action: "read" } }],
            _count: { members: 2 },
          }),
        },
        rolePermission: { deleteMany, createMany },
      }),
    );

    const result = await service.updateRole(STARTUP_ID, "role-collab", {
      description: "Updated",
      permissions: ["financial:read"],
    });

    expect(roleUpdate).toHaveBeenCalledWith({ where: { id: "role-collab" }, data: { description: "Updated" } });
    expect(deleteMany).toHaveBeenCalledWith({ where: { roleId: "role-collab" } });
    expect(createMany).toHaveBeenCalledWith({ data: [{ roleId: "role-collab", permissionId: "p-financial-read" }] });
    expect(result).toMatchObject({ description: "Updated", permissions: ["financial:read"], memberCount: 2 });
  });

  it("refuses to change the owner role's permissions", async () => {
    mockPrisma.role.findUnique.mockResolvedValue({ id: "role-owner", startupId: STARTUP_ID, name: "owner" } as never);

    await expect(
      service.updateRole(STARTUP_ID, "role-owner", { permissions: ["financial:read"] }),
    ).rejects.toMatchObject({ statusCode: 403, code: "OWNER_ROLE_LOCKED" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("404s for a role belonging to another startup", async () => {
    mockPrisma.role.findUnique.mockResolvedValue({ id: "role-x", startupId: "other-startup", name: "collaborator" } as never);

    await expect(
      service.updateRole(STARTUP_ID, "role-x", { description: "x" }),
    ).rejects.toMatchObject({ statusCode: 404, code: "ROLE_NOT_FOUND" });
  });
});

describe("StartupService.deleteRole", () => {
  it("refuses to delete a system role", async () => {
    mockPrisma.role.findUnique.mockResolvedValue({
      id: "role-viewer",
      startupId: STARTUP_ID,
      isSystemRole: true,
      _count: { members: 0 },
    } as never);

    await expect(service.deleteRole(STARTUP_ID, "role-viewer")).rejects.toMatchObject({
      statusCode: 403,
      code: "SYSTEM_ROLE",
    });
    expect(mockPrisma.role.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a custom role that still has members", async () => {
    mockPrisma.role.findUnique.mockResolvedValue({
      id: "role-custom",
      startupId: STARTUP_ID,
      isSystemRole: false,
      _count: { members: 3 },
    } as never);

    await expect(service.deleteRole(STARTUP_ID, "role-custom")).rejects.toMatchObject({
      statusCode: 409,
      code: "ROLE_IN_USE",
    });
    expect(mockPrisma.role.delete).not.toHaveBeenCalled();
  });

  it("deletes an unused custom role", async () => {
    mockPrisma.role.findUnique.mockResolvedValue({
      id: "role-custom",
      startupId: STARTUP_ID,
      isSystemRole: false,
      _count: { members: 0 },
    } as never);
    (mockPrisma.role.delete as jest.Mock).mockResolvedValue({});

    await service.deleteRole(STARTUP_ID, "role-custom");

    expect(mockPrisma.role.delete).toHaveBeenCalledWith({ where: { id: "role-custom" } });
  });
});
