import { Prisma } from "@prisma/client";
import { ChatService } from "../../src/services/chat.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupMember: { findMany: jest.fn() },
    conversation: { create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    conversationMember: { findUnique: jest.fn(), findMany: jest.fn() },
    message: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../src/events/realtime-bus", () => ({
  realtimeBus: { publish: jest.fn() },
}));

import { prisma } from "../../src/db/prisma";
import { realtimeBus } from "../../src/events/realtime-bus";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockPublish = realtimeBus.publish as jest.Mock;
const service = new ChatService();

const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const CONVERSATION_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000003";
const MEMBER_ID = "00000000-0000-0000-0000-000000000004";
const OTHER_MEMBER_ID = "00000000-0000-0000-0000-000000000005";
const OTHER_USER_ID = "00000000-0000-0000-0000-000000000006";
const MESSAGE_ID = "00000000-0000-0000-0000-000000000007";

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    startupId: STARTUP_ID,
    name: "general",
    topic: null,
    lastMessageAt: null,
    archivedAt: null,
    createdBy: USER_ID,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    startupId: STARTUP_ID,
    conversationId: CONVERSATION_ID,
    seq: BigInt(1),
    senderId: MEMBER_ID,
    body: "hello",
    clientNonce: "nonce-1",
    editedAt: null,
    deletedAt: null,
    createdAt: new Date("2026-01-01"),
    sender: { id: MEMBER_ID, user: { id: USER_ID, firstName: "A", lastName: "B", avatarUrl: null } },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ChatService.createConversation", () => {
  it("adds every active startup member on creation", async () => {
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([
      { id: MEMBER_ID },
      { id: OTHER_MEMBER_ID },
    ]);
    (mockPrisma.conversation.create as jest.Mock).mockResolvedValue(conversationRow());

    const result = await service.createConversation(
      STARTUP_ID,
      { name: "general" } as never,
      USER_ID,
    );

    expect(mockPrisma.startupMember.findMany).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, status: "active" },
      select: { id: true },
    });
    expect(mockPrisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startupId: STARTUP_ID,
          name: "general",
          createdBy: USER_ID,
          members: {
            create: [{ memberId: MEMBER_ID }, { memberId: OTHER_MEMBER_ID }],
          },
        }),
      }),
    );
    expect(result.data.id).toBe(CONVERSATION_ID);
  });

  it("translates a duplicate channel name into CONVERSATION_NAME_TAKEN", async () => {
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.conversation.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      }),
    );

    await expect(
      service.createConversation(STARTUP_ID, { name: "general" } as never, USER_ID),
    ).rejects.toMatchObject({ statusCode: 409, code: "CONVERSATION_NAME_TAKEN" });
  });
});

describe("ChatService.listConversations", () => {
  it("scopes to conversations the member belongs to", async () => {
    (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([conversationRow()]);

    const result = await service.listConversations(STARTUP_ID, MEMBER_ID);

    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId: STARTUP_ID, archivedAt: null, members: { some: { memberId: MEMBER_ID } } },
      }),
    );
    expect(result.data).toHaveLength(1);
  });
});

describe("ChatService.listMessages", () => {
  it("throws CONVERSATION_NOT_FOUND when the caller is not a member", async () => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.listMessages(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, { limit: 50 } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "CONVERSATION_NOT_FOUND" });

    expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
  });

  it("throws CONVERSATION_NOT_FOUND for a cross-tenant conversation id", async () => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: "other-startup" },
    });

    await expect(
      service.listMessages(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, { limit: 50 } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "CONVERSATION_NOT_FOUND" });
  });

  it("returns messages oldest-first despite fetching newest-first", async () => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: STARTUP_ID },
    });
    const newer = messageRow({ id: "msg-2", seq: BigInt(2) });
    const older = messageRow({ id: "msg-1", seq: BigInt(1) });
    (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([newer, older]);

    const result = await service.listMessages(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, {
      limit: 50,
    } as never);

    expect(result.data.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
    // BigInt seq serializes to a decimal string on the wire.
    expect(result.data[0].seq).toBe("1");
  });
});

describe("ChatService.sendMessage", () => {
  beforeEach(() => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: STARTUP_ID },
    });
  });

  it("creates a message, bumps lastMessageAt, and publishes to other members only", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.$transaction as jest.Mock).mockResolvedValue([messageRow(), conversationRow()]);
    (mockPrisma.conversationMember.findMany as jest.Mock).mockResolvedValue([
      { member: { userId: OTHER_USER_ID } },
      { member: { userId: null } }, // pending invite — no open tab to reach
    ]);

    const result = await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, {
      body: "hello",
      clientNonce: "nonce-1",
    } as never);

    expect(mockPrisma.conversationMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: CONVERSATION_ID, memberId: { not: MEMBER_ID } },
      }),
    );
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(
      OTHER_USER_ID,
      expect.objectContaining({ type: "chat.message.created", conversationId: CONVERSATION_ID }),
    );
    expect(result.data.id).toBe(MESSAGE_ID);
  });

  it("returns the original row on a retried send instead of creating a duplicate", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(messageRow());

    const result = await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, {
      body: "hello",
      clientNonce: "nonce-1",
    } as never);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(result.data.id).toBe(MESSAGE_ID);
  });
});
