import { InviteService } from "../../src/services/invite.service";

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
    auditLog: {
      create: jest.fn(),
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
      name: "viewer",
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
      name: "viewer",
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
      name: "viewer",
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
      name: "viewer",
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
      name: "viewer",
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

  it("allows a collaborator to invite a viewer", async () => {
    (mockPrisma.role.findUnique as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      startupId: STARTUP_ID,
      name: "viewer",
    });
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: ACTOR_ID,
      startupId: STARTUP_ID,
      status: "active",
      role: { name: "collaborator" },
    });
    (mockPrisma.startupMember.create as jest.Mock).mockResolvedValue({});

    await expect(
      service.inviteMember({ email: "new@example.com", roleId: ROLE_ID }, STARTUP_ID, INVITER_ID, ACTOR_ID),
    ).resolves.toHaveProperty("rawToken");
  });

  it("rejects a collaborator inviting into a non-viewer role", async () => {
    (mockPrisma.role.findUnique as jest.Mock).mockResolvedValue({
      id: ROLE_ID,
      startupId: STARTUP_ID,
      name: "collaborator",
    });
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      id: ACTOR_ID,
      startupId: STARTUP_ID,
      status: "active",
      role: { name: "collaborator" },
    });

    await expect(
      service.inviteMember({ email: "new@example.com", roleId: ROLE_ID }, STARTUP_ID, INVITER_ID, ACTOR_ID),
    ).rejects.toMatchObject({ statusCode: 403, code: "INVITE_ROLE_FORBIDDEN" });
  });
});

describe("InviteService.acceptInvite", () => {
  const OTHER_USER_ID = "00000000-0000-0000-0000-0000000000aa";

  const PENDING_INVITE = {
    id: MEMBER_ID,
    startupId: STARTUP_ID,
    userId: null,
    roleId: ROLE_ID,
    status: "pending",
    invitedEmail: "user@example.com",
    inviteTokenHash: TOKEN_HASH,
    inviteExpiresAt: new Date(Date.now() + 3600000),
    startup: { name: "Test Startup" },
  };

  /**
   * The service reads users two ways: by email when nobody is signed in, and by
   * id for the signed-in viewer. Route each to the right fixture.
   */
  function mockUsers(byId: Record<string, unknown>, byEmail: Record<string, unknown> = {}) {
    (mockPrisma.user.findUnique as jest.Mock).mockImplementation(({ where }: any) =>
      Promise.resolve(where.id ? (byId[where.id] ?? null) : (byEmail[where.email] ?? null)),
    );
  }

  /** Captures the data passed to the activating updateMany. */
  function mockActivation() {
    const captured: { where?: any; data?: any } = {};
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
      const tx = {
        startupMember: {
          updateMany: jest.fn().mockImplementation((args: any) => {
            captured.where = args.where;
            captured.data = args.data;
            return { count: 1 };
          }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            startupId: STARTUP_ID,
            userId: USER_ID,
            roleId: ROLE_ID,
            status: "active",
            joinedAt: new Date(),
            createdAt: new Date(),
          }),
        },
        user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      return cb(tx);
    });
    return captured;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("activates membership for the signed-in invitee", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue(PENDING_INVITE);
    mockUsers({ [USER_ID]: { id: USER_ID, email: "user@example.com" } });
    mockActivation();

    const result = await service.acceptInvite({ token: "rawtoken" }, USER_ID);

    expect("data" in result).toBe(true);
    if ("data" in result) {
      expect(result.data.status).toBe("active");
      expect(result.data.userId).toBe(USER_ID);
    }
  });

  it("refuses to activate when a different account opens the link", async () => {
    // The bug this guards: the invitation used to be activated for whoever
    // owned the invited email, so any signed-in stranger clicking the link
    // silently joined the invitee to the workspace and burned the token.
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue(PENDING_INVITE);
    mockUsers({ [OTHER_USER_ID]: { id: OTHER_USER_ID, email: "someone.else@example.com" } });

    const result = await service.acceptInvite({ token: "rawtoken" }, OTHER_USER_ID);

    expect(result).toEqual({
      emailMismatch: true,
      invitedEmail: "user@example.com",
      signedInAs: "someone.else@example.com",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("matches the invited address case-insensitively", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      ...PENDING_INVITE,
      invitedEmail: "User@Example.com",
    });
    mockUsers({ [USER_ID]: { id: USER_ID, email: "user@example.com" } });
    mockActivation();

    const result = await service.acceptInvite({ token: "rawtoken" }, USER_ID);

    expect("data" in result).toBe(true);
  });

  it("leaves the invitation alone when nobody is signed in", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue(PENDING_INVITE);
    mockUsers({}, { "user@example.com": { id: USER_ID } });

    const result = await service.acceptInvite({ token: "rawtoken" }, null);

    expect(result).toEqual({ requiresLogin: true, email: "user@example.com" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns requiresRegistration for an unregistered email", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      ...PENDING_INVITE,
      invitedEmail: "newuser@example.com",
    });
    mockUsers({}, {});

    const result = await service.acceptInvite({ token: "rawtoken" }, null);

    expect(result).toEqual({
      requiresRegistration: true,
      email: "newuser@example.com",
    });
  });

  it("throws INVALID_TOKEN for non-existent token", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.acceptInvite({ token: "invalid" }, USER_ID),
    ).rejects.toMatchObject({ statusCode: 404, code: "INVALID_TOKEN" });
  });

  it("throws TOKEN_EXPIRED for expired invitation", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      ...PENDING_INVITE,
      inviteExpiresAt: new Date(Date.now() - 3600000),
    });

    await expect(
      service.acceptInvite({ token: "rawtoken" }, USER_ID),
    ).rejects.toMatchObject({ statusCode: 410, code: "TOKEN_EXPIRED" });
  });

  it("throws ALREADY_ACCEPTED when the accepted invite belongs to someone else", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      ...PENDING_INVITE,
      status: "active",
      userId: USER_ID,
      inviteExpiresAt: null,
    });

    await expect(
      service.acceptInvite({ token: "rawtoken" }, OTHER_USER_ID),
    ).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_ACCEPTED" });
  });

  it("is idempotent for the member who already accepted", async () => {
    // Opening the emailed link after registration already claimed the invite
    // used to read as "invalid link". It now confirms the membership instead.
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      ...PENDING_INVITE,
      status: "active",
      userId: USER_ID,
      joinedAt: new Date(),
      createdAt: new Date(),
      inviteExpiresAt: null,
    });

    const result = await service.acceptInvite({ token: "rawtoken" }, USER_ID);

    expect("data" in result).toBe(true);
    if ("data" in result) {
      expect(result.data.userId).toBe(USER_ID);
      expect(result.data.status).toBe("active");
    }
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("only activates a row that is still pending", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue(PENDING_INVITE);
    mockUsers({ [USER_ID]: { id: USER_ID, email: "user@example.com" } });
    const captured = mockActivation();

    await service.acceptInvite({ token: "rawtoken" }, USER_ID);

    // Guards two clicks racing: the loser matches nothing and bails.
    expect(captured.where).toMatchObject({ id: MEMBER_ID, status: "pending" });
    expect(captured.data.userId).toBe(USER_ID);
    expect(captured.data.status).toBe("active");
    // The hash survives so the link keeps resolving to "you're in".
    expect(captured.data.inviteTokenHash).toBeUndefined();
    expect(captured.data.inviteExpiresAt).toBeNull();
  });

  it("rejects a concurrent second activation", async () => {
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue(PENDING_INVITE);
    mockUsers({ [USER_ID]: { id: USER_ID, email: "user@example.com" } });
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) =>
      cb({
        startupMember: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findUniqueOrThrow: jest.fn(),
        },
        user: { updateMany: jest.fn() },
      }),
    );

    await expect(
      service.acceptInvite({ token: "rawtoken" }, USER_ID),
    ).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_ACCEPTED" });
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

    const result = await service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, ACTOR_ID, INVITER_ID);

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
      service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, ACTOR_ID, INVITER_ID),
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
      service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, MEMBER_ID, INVITER_ID),
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
      service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, MEMBER_ID, INVITER_ID),
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
      service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, MEMBER_ID, INVITER_ID),
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

    const result = await service.changeRole(STARTUP_ID, MEMBER_ID, { roleId: ROLE_ID }, MEMBER_ID, INVITER_ID);
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
        // Removing a member hands back what they held first the composite
        // FKs cannot SET NULL alone without nulling startupId too.
        pipeline: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        task: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        message: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
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
        // Removing a member hands back what they held first the composite
        // FKs cannot SET NULL alone without nulling startupId too.
        pipeline: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        task: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        message: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
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
        pipeline: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        task: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        message: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      return cb(tx);
    });

    await service.removeMember(STARTUP_ID, MEMBER_ID, USER_ID);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  // Regression: the composite FKs on Pipeline.owner / Task.assignee cannot
  // ON DELETE SET NULL, because that nulls startupId too and it is NOT NULL.
  // Without this hand-back the delete fails on the constraint and the member
  // simply cannot be removed.
  it("un-owns the member's deals and unassigns their tasks before deleting them", async () => {
    const pipelineUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const taskUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    const messageUpdateMany = jest.fn().mockResolvedValue({ count: 3 });
    const memberDelete = jest.fn().mockResolvedValue({});
    const order: string[] = [];

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
          delete: (...args: unknown[]) => {
            order.push("delete");
            return memberDelete(...args);
          },
        },
        pipeline: {
          updateMany: (...args: unknown[]) => {
            order.push("pipeline");
            return pipelineUpdateMany(...args);
          },
        },
        task: {
          updateMany: (...args: unknown[]) => {
            order.push("task");
            return taskUpdateMany(...args);
          },
        },
        message: {
          updateMany: (...args: unknown[]) => {
            order.push("message");
            return messageUpdateMany(...args);
          },
        },
      };
      return cb(tx);
    });

    await service.removeMember(STARTUP_ID, MEMBER_ID, INVITER_ID);

    expect(pipelineUpdateMany).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, ownerId: MEMBER_ID },
      data: { ownerId: null },
    });
    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, assigneeId: MEMBER_ID },
      data: { assigneeId: null },
    });
    expect(messageUpdateMany).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, senderId: MEMBER_ID },
      data: { senderId: null },
    });
    // Every hand-back must land before the row goes, or the FK rejects it.
    expect(order).toEqual(["pipeline", "task", "message", "delete"]);
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

    const [[claim]] = mockTx.startupMember.updateMany.mock.calls as [[{ data: any }]];
    expect(claim.data).toMatchObject({
      userId: USER_ID,
      status: "active",
      joinedAt: expect.any(Date),
      inviteExpiresAt: null,
    });
    // The hash is kept so the emailed link still resolves to "you're in"
    // rather than "invalid invitation" now that registration has claimed it.
    expect(claim.data.inviteTokenHash).toBeUndefined();
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
