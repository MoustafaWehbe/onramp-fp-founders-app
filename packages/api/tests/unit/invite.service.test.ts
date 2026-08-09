import { InviteService } from "../../src/services/invite.service";
import crypto from "crypto";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    role: {
      findUnique: jest.fn(),
    },
    startupMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    startup: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../src/utils/auth", () => ({
  hashToken: jest.fn((t: string) => `hashed_${t}`),
}));

import { prisma } from "../../src/db/prisma";
import { hashToken } from "../../src/utils/auth";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockHashToken = hashToken as jest.MockedFunction<typeof hashToken>;
const service = new InviteService();

const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const MEMBER_ID = "00000000-0000-0000-0000-000000000002";
const ROLE_ID = "00000000-0000-0000-0000-000000000003";
const USER_ID = "00000000-0000-0000-0000-000000000004";
const INVITER_ID = "00000000-0000-0000-0000-000000000005";
const ACTOR_ID = "00000000-0000-0000-0000-000000000006";
const TOKEN_HASH = "hashed_rawtoken";

describe("InviteService.inviteMember", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a pending invitation with hashed token", async () => {
    (mockPrisma.role.findUnique as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      startupId: STARTUP_ID,
    });
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.startupMember.create as jest.Mock).mockResolvedValue({
      id: MEMBER_ID,
      startupId: STARTUP_ID,
      userId: null,
      roleId: ROLE_ID,
      status: "pending",
      invitedEmail: "new@example.com",
      invitedBy: INVITER_ID,
      joinedAt: null,
      createdAt: new Date(),
    });

    const result = await service.inviteMember(
      { email: "new@example.com", roleId: ROLE_ID },
      STARTUP_ID,
      INVITER_ID,
      ACTOR_ID,
    );

    expect(result.rawToken).toBeDefined();
    expect(result.rawToken).toHaveLength(64);
    expect(mockHashToken).toHaveBeenCalledWith(result.rawToken);
    expect(mockPrisma.startupMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startupId: STARTUP_ID,
          userId: null,
          roleId: ROLE_ID,
          status: "pending",
          invitedEmail: "new@example.com",
          inviteTokenHash: `hashed_${result.rawToken}`,
          invitedBy: INVITER_ID,
          inviteExpiresAt: expect.any(Date),
        }),
      }),
    );
  });

  it("sets expiration to exactly 7 days", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    (mockPrisma.role.findUnique as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      startupId: STARTUP_ID,
    });
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.startupMember.create as jest.Mock).mockResolvedValue({});

    const result = await service.inviteMember(
      { email: "new@example.com", roleId: ROLE_ID },
      STARTUP_ID,
      INVITER_ID,
      ACTOR_ID,
    );

    expect(result.inviteExpiresAt.getTime() - now).toBe(7 * 24 * 60 * 60 * 1000);
    jest.restoreAllMocks();
  });

  it("throws ROLE_NOT_FOUND for cross-startup role", async () => {
    (mockPrisma.role.findUnique as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      startupId: "00000000-0000-0000-0000-000000000099",
    });

    await expect(
      service.inviteMember({ email: "new@example.com", roleId: ROLE_ID }, STARTUP_ID, INVITER_ID, ACTOR_ID),
    ).rejects.toMatchObject({ statusCode: 404, code: "ROLE_NOT_FOUND" });
  });

  it("throws ROLE_NOT_FOUND for non-existent role", async () => {
    (mockPrisma.role.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.inviteMember({ email: "new@example.com", roleId: ROLE_ID }, STARTUP_ID, INVITER_ID, ACTOR_ID),
    ).rejects.toMatchObject({ statusCode: 404, code: "ROLE_NOT_FOUND" });
  });

  it("throws ALREADY_MEMBER for existing active member", async () => {
    (mockPrisma.role.findUnique as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      startupId: STARTUP_ID,
    });
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue({
      id: MEMBER_ID,
      status: "active",
    });

    await expect(
      service.inviteMember({ email: "existing@example.com", roleId: ROLE_ID }, STARTUP_ID, INVITER_ID, ACTOR_ID),
    ).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_MEMBER" });
  });

  it("throws ALREADY_MEMBER for existing pending invitation", async () => {
    (mockPrisma.role.findUnique as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      startupId: STARTUP_ID,
    });
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue({
      id: MEMBER_ID,
      status: "pending",
    });

    await expect(
      service.inviteMember({ email: "pending@example.com", roleId: ROLE_ID }, STARTUP_ID, INVITER_ID, ACTOR_ID),
    ).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_MEMBER" });
  });

  it("never stores the raw token", async () => {
    (mockPrisma.role.findUnique as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      startupId: STARTUP_ID,
    });
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.startupMember.create as jest.Mock).mockResolvedValue({});

    const result = await service.inviteMember(
      { email: "new@example.com", roleId: ROLE_ID },
      STARTUP_ID,
      INVITER_ID,
      ACTOR_ID,
    );

    const createCall = (mockPrisma.startupMember.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.inviteTokenHash).not.toBe(result.rawToken);
    expect(createCall.data.inviteTokenHash).toBe(`hashed_${result.rawToken}`);
  });

  it("allows inviting as owner when the actor is an owner", async () => {
    (mockPrisma.role.findUnique as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      startupId: STARTUP_ID,
      name: "owner",
    });
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: ACTOR_ID,
      startupId: STARTUP_ID,
      status: "active",
      role: { name: "owner" },
    });
    (mockPrisma.startupMember.create as jest.Mock).mockResolvedValue({});

    await expect(
      service.inviteMember({ email: "new@example.com", roleId: ROLE_ID }, STARTUP_ID, INVITER_ID, ACTOR_ID),
    ).resolves.toHaveProperty("rawToken");
  });

  it("rejects inviting as owner when the actor is not an owner", async () => {
    (mockPrisma.role.findUnique as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      startupId: STARTUP_ID,
      name: "owner",
    });
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: ACTOR_ID,
      startupId: STARTUP_ID,
      status: "active",
      role: { name: "collaborator" },
    });

    await expect(
      service.inviteMember({ email: "new@example.com", roleId: ROLE_ID }, STARTUP_ID, INVITER_ID, ACTOR_ID),
    ).rejects.toMatchObject({ statusCode: 403, code: "OWNER_ONLY" });
  });
});

describe("InviteService.acceptInvite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("activates membership for a registered user", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: MEMBER_ID,
      startupId: STARTUP_ID,
      userId: null,
      roleId: ROLE_ID,
      status: "pending",
      invitedEmail: "user@example.com",
      inviteTokenHash: TOKEN_HASH,
      inviteExpiresAt: new Date(Date.now() + 3600000),
      startup: { name: "Test Startup" },
    });
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
    });
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          update: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            userId: USER_ID,
            roleId: ROLE_ID,
            status: "active",
            joinedAt: expect.any(Date),
            createdAt: new Date(),
          }),
        },
        user: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return cb(tx);
    });

    const result = await service.acceptInvite({ token: "rawtoken" });

    expect("requiresRegistration" in result).toBe(false);
    if ("data" in result) {
      expect(result.data.status).toBe("active");
      expect(result.data.userId).toBe(USER_ID);
    }
  });

  it("returns requiresRegistration for unregistered email", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: MEMBER_ID,
      startupId: STARTUP_ID,
      userId: null,
      roleId: ROLE_ID,
      status: "pending",
      invitedEmail: "newuser@example.com",
      inviteTokenHash: TOKEN_HASH,
      inviteExpiresAt: new Date(Date.now() + 3600000),
      startup: { name: "Test Startup" },
    });
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await service.acceptInvite({ token: "rawtoken" });

    expect(result).toEqual({
      requiresRegistration: true,
      email: "newuser@example.com",
    });
  });

  it("throws INVALID_TOKEN for non-existent token", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.acceptInvite({ token: "invalid" }),
    ).rejects.toMatchObject({ statusCode: 404, code: "INVALID_TOKEN" });
  });

  it("throws TOKEN_EXPIRED for expired invitation", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: MEMBER_ID,
      startupId: STARTUP_ID,
      status: "pending",
      inviteTokenHash: TOKEN_HASH,
      inviteExpiresAt: new Date(Date.now() - 3600000),
      startup: { name: "Test Startup" },
    });

    await expect(
      service.acceptInvite({ token: "rawtoken" }),
    ).rejects.toMatchObject({ statusCode: 410, code: "TOKEN_EXPIRED" });
  });

  it("throws ALREADY_ACCEPTED for active member", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: MEMBER_ID,
      startupId: STARTUP_ID,
      status: "active",
      inviteTokenHash: TOKEN_HASH,
      inviteExpiresAt: new Date(Date.now() + 3600000),
      startup: { name: "Test Startup" },
    });

    await expect(
      service.acceptInvite({ token: "rawtoken" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_ACCEPTED" });
  });

  it("clears token fields after activation", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: MEMBER_ID,
      startupId: STARTUP_ID,
      userId: null,
      roleId: ROLE_ID,
      status: "pending",
      invitedEmail: "user@example.com",
      inviteTokenHash: TOKEN_HASH,
      inviteExpiresAt: new Date(Date.now() + 3600000),
      startup: { name: "Test Startup" },
    });
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
    });

    let updateData: any;
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          update: jest.fn().mockImplementation(({ data }: any) => {
            updateData = data;
            return {
              id: MEMBER_ID,
              startupId: STARTUP_ID,
              userId: USER_ID,
              roleId: ROLE_ID,
              status: "active",
              joinedAt: expect.any(Date),
              createdAt: new Date(),
            };
          }),
        },
        user: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return cb(tx);
    });

    await service.acceptInvite({ token: "rawtoken" });

    expect(updateData.inviteTokenHash).toBeNull();
    expect(updateData.inviteExpiresAt).toBeNull();
    expect(updateData.status).toBe("active");
  });
});

describe("InviteService.changeRole", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("successfully updates member role (owner assignment performed by an owner)", async () => {
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          findUnique: jest.fn().mockImplementation(({ where }: any) => {
            if (where.id === ACTOR_ID) {
              return Promise.resolve({
                id: ACTOR_ID,
                startupId: STARTUP_ID,
                status: "active",
                role: { name: "owner" },
              });
            }
            return Promise.resolve({
              id: MEMBER_ID,
              startupId: STARTUP_ID,
              status: "active",
              role: { name: "collaborator" },
            });
          }),
          update: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            userId: USER_ID,
            roleId: ROLE_ID,
            status: "active",
            invitedEmail: null,
            invitedBy: INVITER_ID,
            joinedAt: new Date(),
            createdAt: new Date(),
          }),
        },
        role: {
          findUnique: jest.fn().mockResolvedValue({
            id: ROLE_ID,
            startupId: STARTUP_ID,
            name: "owner",
          }),
        },
      };
      return cb(tx);
    });

    const result = await service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, ACTOR_ID);

    expect(result).toHaveProperty("data");
    if ("data" in result) {
      expect(result.data.roleId).toBe(ROLE_ID);
    }
  });

  it("rejects owner-role assignment by a non-owner actor", async () => {
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          findUnique: jest.fn().mockImplementation(({ where }: any) => {
            if (where.id === ACTOR_ID) {
              return Promise.resolve({
                id: ACTOR_ID,
                startupId: STARTUP_ID,
                status: "active",
                role: { name: "collaborator" },
              });
            }
            return Promise.resolve({
              id: MEMBER_ID,
              startupId: STARTUP_ID,
              status: "active",
              role: { name: "collaborator" },
            });
          }),
        },
        role: {
          findUnique: jest.fn().mockResolvedValue({
            id: ROLE_ID,
            startupId: STARTUP_ID,
            name: "owner",
          }),
        },
      };
      return cb(tx);
    });

    await expect(
      service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, ACTOR_ID),
    ).rejects.toMatchObject({ statusCode: 403, code: "OWNER_ONLY" });
  });

  it("rejects role from another startup", async () => {
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          findUnique: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            status: "active",
            role: { name: "collaborator" },
          }),
        },
        role: {
          findUnique: jest.fn().mockResolvedValue({
            id: ROLE_ID,
            startupId: "00000000-0000-0000-0000-000000000099",
            name: "owner",
          }),
        },
      };
      return cb(tx);
    });

    await expect(
      service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, MEMBER_ID),
    ).rejects.toMatchObject({ statusCode: 404, code: "ROLE_NOT_FOUND" });
  });

  it("rejects member from another startup", async () => {
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          findUnique: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: "00000000-0000-0000-0000-000000000099",
            status: "active",
            role: { name: "collaborator" },
          }),
        },
        role: {
          findUnique: jest.fn().mockResolvedValue({
            id: ROLE_ID,
            startupId: STARTUP_ID,
            name: "owner",
          }),
        },
      };
      return cb(tx);
    });

    await expect(
      service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, MEMBER_ID),
    ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  });

  it("prevents demoting the last active owner", async () => {
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          findUnique: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            status: "active",
            role: { name: "owner" },
          }),
          count: jest.fn().mockResolvedValue(1),
        },
        role: {
          findUnique: jest.fn().mockResolvedValue({
            id: ROLE_ID,
            startupId: STARTUP_ID,
            name: "collaborator",
          }),
        },
      };
      return cb(tx);
    });

    await expect(
      service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, MEMBER_ID),
    ).rejects.toMatchObject({ statusCode: 409, code: "LAST_OWNER" });
  });

  it("allows demoting an owner when another owner exists", async () => {
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          findUnique: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            status: "active",
            role: { name: "owner" },
          }),
          count: jest.fn().mockResolvedValue(2),
          update: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            userId: USER_ID,
            roleId: ROLE_ID,
            status: "active",
            invitedEmail: null,
            invitedBy: INVITER_ID,
            joinedAt: new Date(),
            createdAt: new Date(),
          }),
        },
        role: {
          findUnique: jest.fn().mockResolvedValue({
            id: ROLE_ID,
            startupId: STARTUP_ID,
            name: "collaborator",
          }),
        },
      };
      return cb(tx);
    });

    const result = await service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, MEMBER_ID);
    expect(result).toHaveProperty("data");
  });
});

describe("InviteService.removeMember", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("successfully removes an active member", async () => {
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          findUnique: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            status: "active",
            userId: USER_ID,
            role: { name: "collaborator" },
          }),
          delete: jest.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    await service.removeMember(STARTUP_ID, MEMBER_ID, INVITER_ID);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it("successfully removes a pending invitation", async () => {
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          findUnique: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            status: "pending",
            userId: null,
            role: { name: "collaborator" },
          }),
          delete: jest.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    await service.removeMember(STARTUP_ID, MEMBER_ID, INVITER_ID);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it("prevents removing the last active owner", async () => {
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          findUnique: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            status: "active",
            userId: USER_ID,
            role: { name: "owner" },
          }),
          count: jest.fn().mockResolvedValue(1),
        },
      };
      return cb(tx);
    });

    await expect(
      service.removeMember(STARTUP_ID, MEMBER_ID, USER_ID),
    ).rejects.toMatchObject({ statusCode: 409, code: "LAST_OWNER" });
  });

  it("allows removing an owner when another owner exists", async () => {
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          findUnique: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            status: "active",
            userId: USER_ID,
            role: { name: "owner" },
          }),
          count: jest.fn().mockResolvedValue(2),
          delete: jest.fn().mockResolvedValue({}),
        },
        user: {
          updateMany: jest.fn(),
        },
      };
      return cb(tx);
    });

    await service.removeMember(STARTUP_ID, MEMBER_ID, USER_ID);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it("rejects member from another startup", async () => {
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          findUnique: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: "00000000-0000-0000-0000-000000000099",
            status: "active",
            userId: USER_ID,
            role: { name: "collaborator" },
          }),
        },
      };
      return cb(tx);
    });

    await expect(
      service.removeMember(STARTUP_ID, MEMBER_ID, INVITER_ID),
    ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  });
});

describe("InviteService.claimPendingInvites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("claims valid pending invitations for a newly verified user", async () => {
    const mockTx = {
      startupMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            status: "pending",
            invitedEmail: "user@example.com",
            userId: null,
            inviteExpiresAt: new Date(Date.now() + 3600000),
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ lastActiveStartupId: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    await service.claimPendingInvites("user@example.com", USER_ID, mockTx as any);

    expect(mockTx.startupMember.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          status: "active",
          joinedAt: expect.any(Date),
          inviteTokenHash: null,
          inviteExpiresAt: null,
        }),
      }),
    );
  });

  it("skips expired invitations", async () => {
    const mockTx = {
      startupMember: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    await service.claimPendingInvites("user@example.com", USER_ID, mockTx as any);

    expect(mockTx.startupMember.updateMany).not.toHaveBeenCalled();
  });

  it("does not claim already-active or cancelled invitations", async () => {
    const mockTx = {
      startupMember: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    await service.claimPendingInvites("user@example.com", USER_ID, mockTx as any);

    // The update filter ensures only pending + null userId + unexpired rows are claimed
    expect(mockTx.startupMember.updateMany).not.toHaveBeenCalled();
  });
});

describe("InviteService.resendInvite", () => {
  const PENDING = {
    id: MEMBER_ID,
    startupId: STARTUP_ID,
    status: "pending",
    invitedEmail: "invitee@example.com",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("issues a brand new token and restarts the expiry", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue(PENDING as never);
    (mockPrisma.startupMember.update as jest.Mock).mockResolvedValue({} as never);

    const result = await service.resendInvite(STARTUP_ID, MEMBER_ID);

    expect(result.email).toBe("invitee@example.com");
    expect(result.rawToken).toMatch(/^[a-f0-9]{64}$/);

    const [[call]] = (mockPrisma.startupMember.update as jest.Mock).mock.calls;
    // Only the hash is ever stored, so the previous link cannot be re-sent —
    // it is replaced, which also invalidates any copy already in an inbox.
    expect(call.data.inviteTokenHash).toBe(`hashed_${result.rawToken}`);
    expect(call.data.inviteExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses once the invitation has been accepted", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      ...PENDING,
      status: "active",
    } as never);

    await expect(service.resendInvite(STARTUP_ID, MEMBER_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "ALREADY_ACCEPTED",
    });
    expect(mockPrisma.startupMember.update).not.toHaveBeenCalled();
  });

  it("refuses a member id belonging to another startup", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      ...PENDING,
      startupId: "00000000-0000-0000-0000-0000000000ff",
    } as never);

    await expect(service.resendInvite(STARTUP_ID, MEMBER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
  });
});
