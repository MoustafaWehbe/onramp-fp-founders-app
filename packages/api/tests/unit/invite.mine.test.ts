import { InviteService } from "../../src/services/invite.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../src/utils/auth", () => ({ hashToken: jest.fn((t: string) => `hashed_${t}`) }));

import { prisma } from "../../src/db/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const service = new InviteService();

const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const MEMBER_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000004";

const PENDING = {
  id: MEMBER_ID,
  status: "pending",
  invitedEmail: "invitee@example.com",
  inviteExpiresAt: new Date(Date.now() + 3600_000),
};

function mockLookup(member: unknown, email: string | null = "invitee@example.com") {
  (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue(member);
  (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(email ? { email } : null);
}

function mockActivation() {
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) =>
    cb({
      startupMember: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: MEMBER_ID,
          startupId: STARTUP_ID,
          userId: USER_ID,
          status: "active",
        }),
      },
      user: { updateMany: jest.fn() },
    }),
  );
}

beforeEach(() => jest.clearAllMocks());

describe("InviteService.listMyInvites", () => {
  it("only returns unexpired, unclaimed invitations for the caller's address", async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "invitee@example.com" });
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([]);

    await service.listMyInvites(USER_ID);

    const [[call]] = (mockPrisma.startupMember.findMany as jest.Mock).mock.calls;
    expect(call.where).toMatchObject({
      invitedEmail: "invitee@example.com",
      status: "pending",
      userId: null,
    });
    expect(call.where.inviteExpiresAt.gt).toBeInstanceOf(Date);
  });

  it("returns nothing for a user that no longer exists", async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.listMyInvites(USER_ID)).resolves.toEqual([]);
    expect(mockPrisma.startupMember.findMany).not.toHaveBeenCalled();
  });
});

describe("InviteService.acceptMyInvite", () => {
  it("activates the membership for the signed-in invitee", async () => {
    mockLookup(PENDING);
    mockActivation();

    const member = await service.acceptMyInvite(MEMBER_ID, USER_ID);

    expect(member.status).toBe("active");
    expect(member.userId).toBe(USER_ID);
  });

  it("matches the invited address case-insensitively", async () => {
    mockLookup({ ...PENDING, invitedEmail: "Invitee@Example.com" });
    mockActivation();

    await expect(service.acceptMyInvite(MEMBER_ID, USER_ID)).resolves.toMatchObject({
      status: "active",
    });
  });

  it("hides an invitation addressed to somebody else behind a 404", async () => {
    // Reporting 403 would confirm the membership exists to a caller who has no
    // business knowing that.
    mockLookup(PENDING, "someone.else@example.com");

    await expect(service.acceptMyInvite(MEMBER_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an invitation that was already accepted", async () => {
    mockLookup({ ...PENDING, status: "active" });

    await expect(service.acceptMyInvite(MEMBER_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "ALREADY_ACCEPTED",
    });
  });

  it("refuses an expired invitation", async () => {
    mockLookup({ ...PENDING, inviteExpiresAt: new Date(Date.now() - 1000) });

    await expect(service.acceptMyInvite(MEMBER_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 410,
      code: "TOKEN_EXPIRED",
    });
  });
});

describe("InviteService.declineMyInvite", () => {
  it("removes the pending row", async () => {
    mockLookup(PENDING);
    (mockPrisma.startupMember.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

    await service.declineMyInvite(MEMBER_ID, USER_ID);

    expect(mockPrisma.startupMember.deleteMany).toHaveBeenCalledWith({
      where: { id: MEMBER_ID, status: "pending" },
    });
  });

  it("will not delete somebody else's invitation", async () => {
    mockLookup(PENDING, "someone.else@example.com");

    await expect(service.declineMyInvite(MEMBER_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockPrisma.startupMember.deleteMany).not.toHaveBeenCalled();
  });
});
