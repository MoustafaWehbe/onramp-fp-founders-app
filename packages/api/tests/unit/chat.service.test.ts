import { Prisma } from "@prisma/client";
import { ChatService } from "../../src/services/chat.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupMember: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    startupInvestor: { findMany: jest.fn() },
    pipeline: { findMany: jest.fn() },
    task: { findMany: jest.fn() },
    fundraisingRound: { findMany: jest.fn() },
    document: { findMany: jest.fn() },
    rolePermission: { findMany: jest.fn() },
    messageMention: { findMany: jest.fn() },
    messageReaction: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    conversation: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    conversationMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../src/events/realtime-bus", () => ({
  realtimeBus: { publish: jest.fn() },
}));

jest.mock("../../src/services/notification.service", () => ({
  notificationService: { notifyMention: jest.fn() },
}));

import { prisma } from "../../src/db/prisma";
import { realtimeBus } from "../../src/events/realtime-bus";
import { notificationService } from "../../src/services/notification.service";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockPublish = realtimeBus.publish as jest.Mock;
const mockNotifyMention = notificationService.notifyMention as jest.Mock;
const service = new ChatService();

const STARTUP_ID = "00000000-0000-0000-0000-000000000001";
const CONVERSATION_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000003";
const MEMBER_ID = "00000000-0000-0000-0000-000000000004";
const OTHER_MEMBER_ID = "00000000-0000-0000-0000-000000000005";
const OTHER_USER_ID = "00000000-0000-0000-0000-000000000006";
const MESSAGE_ID = "00000000-0000-0000-0000-000000000007";
const DEAL_ID = "00000000-0000-0000-0000-000000000008";
const ROLE_ID = "00000000-0000-0000-0000-000000000009";
const DOCUMENT_ID = "00000000-0000-0000-0000-00000000000a";
const PARENT_MESSAGE_ID = "00000000-0000-0000-0000-00000000000b";

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    startupId: STARTUP_ID,
    type: "channel",
    name: "general",
    topic: null,
    lastMessageAt: null,
    archivedAt: null,
    createdBy: USER_ID,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    members: [],
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
    parentMessageId: null,
    replyCount: 0,
    body: "hello",
    clientNonce: "nonce-1",
    editedAt: null,
    deletedAt: null,
    createdAt: new Date("2026-01-01"),
    sender: { id: MEMBER_ID, user: { id: USER_ID, firstName: "A", lastName: "B", avatarUrl: null } },
    reactions: [],
    attachments: [],
    ...overrides,
  };
}

/** Wires $transaction to invoke the callback with a tx stub, capturing what was written. */
function mockTransaction(overrides: Record<string, unknown> = {}) {
  const tx = {
    message: {
      create: jest.fn().mockResolvedValue(messageRow()),
      update: jest.fn().mockResolvedValue(messageRow()),
    },
    conversation: { update: jest.fn().mockResolvedValue(conversationRow()) },
    conversationMember: { update: jest.fn().mockResolvedValue({}) },
    messageMention: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    messageAttachment: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    ...overrides,
  };
  (mockPrisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb(tx),
  );
  return tx;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ChatService.createConversation", () => {
  it("adds only the creator and selected active teammates", async () => {
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([
      { id: MEMBER_ID },
      { id: OTHER_MEMBER_ID },
    ]);
    (mockPrisma.conversation.create as jest.Mock).mockResolvedValue(conversationRow());

    const result = await service.createConversation(
      STARTUP_ID,
      { name: "general", memberIds: [OTHER_MEMBER_ID] } as never,
      USER_ID,
      MEMBER_ID,
    );

    expect(mockPrisma.startupMember.findMany).toHaveBeenCalledWith({
      where: { startupId: STARTUP_ID, status: "active", id: { in: [MEMBER_ID, OTHER_MEMBER_ID] } },
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
    expect(result.data.unreadCount).toBe(0);
  });

  it("translates a duplicate channel name into CONVERSATION_NAME_TAKEN", async () => {
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([{ id: MEMBER_ID }]);
    (mockPrisma.conversation.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      }),
    );

    await expect(
      service.createConversation(STARTUP_ID, { name: "general" } as never, USER_ID, MEMBER_ID),
    ).rejects.toMatchObject({ statusCode: 409, code: "CONVERSATION_NAME_TAKEN" });
  });

  it("rejects selected members who are not active in this workspace", async () => {
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([{ id: MEMBER_ID }]);

    await expect(
      service.createConversation(
        STARTUP_ID,
        { name: "private", memberIds: [OTHER_MEMBER_ID] } as never,
        USER_ID,
        MEMBER_ID,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_CHANNEL_MEMBERS" });
    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
  });
});

describe("ChatService.startDirectMessage", () => {
  it("rejects DMing yourself", async () => {
    await expect(
      service.startDirectMessage(STARTUP_ID, MEMBER_ID, USER_ID, MEMBER_ID),
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_DM_TARGET" });
  });

  it("404s when the other member is not active in this startup", async () => {
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.startDirectMessage(STARTUP_ID, MEMBER_ID, USER_ID, OTHER_MEMBER_ID),
    ).rejects.toMatchObject({ statusCode: 404, code: "MEMBER_NOT_FOUND" });
  });

  it("reuses an existing DM found by the sorted member-pair key", async () => {
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue({ id: OTHER_MEMBER_ID });
    const existing = conversationRow({
      type: "dm",
      name: null,
      members: [
        { memberId: MEMBER_ID, lastReadSeq: null, notifyLevel: "all", member: { id: MEMBER_ID, user: null } },
        {
          memberId: OTHER_MEMBER_ID,
          lastReadSeq: null,
          notifyLevel: "all",
          member: { id: OTHER_MEMBER_ID, user: { firstName: "Maya", lastName: "Lee", avatarUrl: null } },
        },
      ],
    });
    (mockPrisma.conversation.findUnique as jest.Mock).mockResolvedValue(existing);
    (mockPrisma.message.count as jest.Mock).mockResolvedValue(0);

    const result = await service.startDirectMessage(STARTUP_ID, MEMBER_ID, USER_ID, OTHER_MEMBER_ID);

    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
    expect(result.data.type).toBe("dm");
    expect(result.data.counterpart).toEqual(
      expect.objectContaining({ memberId: OTHER_MEMBER_ID, firstName: "Maya" }),
    );
  });

  it("creates a new DM with both members when none exists", async () => {
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue({ id: OTHER_MEMBER_ID });
    (mockPrisma.conversation.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.conversation.create as jest.Mock).mockResolvedValue(
      conversationRow({ type: "dm", name: null }),
    );

    const result = await service.startDirectMessage(STARTUP_ID, MEMBER_ID, USER_ID, OTHER_MEMBER_ID);

    expect(mockPrisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "dm",
          dmKey: [MEMBER_ID, OTHER_MEMBER_ID].sort().join(":"),
          members: { create: [{ memberId: MEMBER_ID }, { memberId: OTHER_MEMBER_ID }] },
        }),
      }),
    );
    expect(result.data.type).toBe("dm");
  });

  it("reads back the winner instead of erroring when two tabs race to create the same DM", async () => {
    (mockPrisma.startupMember.findFirst as jest.Mock).mockResolvedValue({ id: OTHER_MEMBER_ID });
    (mockPrisma.conversation.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.conversation.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      }),
    );
    (mockPrisma.conversation.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      conversationRow({ type: "dm", name: null }),
    );
    (mockPrisma.message.count as jest.Mock).mockResolvedValue(0);

    const result = await service.startDirectMessage(STARTUP_ID, MEMBER_ID, USER_ID, OTHER_MEMBER_ID);

    expect(result.data.type).toBe("dm");
  });
});

describe("ChatService.listConversations", () => {
  it("scopes to conversations the member belongs to and includes unread counts", async () => {
    (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([conversationRow()]);
    (mockPrisma.message.count as jest.Mock).mockResolvedValue(3);

    const result = await service.listConversations(STARTUP_ID, MEMBER_ID);

    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId: STARTUP_ID, archivedAt: null, members: { some: { memberId: MEMBER_ID } } },
      }),
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].unreadCount).toBe(3);
  });

  it("includes archived member channels only when requested", async () => {
    (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

    await service.listConversations(STARTUP_ID, MEMBER_ID, { includeArchived: true });

    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startupId: STARTUP_ID, members: { some: { memberId: MEMBER_ID } } },
      }),
    );
  });
});

describe("ChatService.searchMessages", () => {
  it("scopes the query through the caller's own ConversationMember rows, never by startupId alone", async () => {
    (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);

    await service.searchMessages(STARTUP_ID, MEMBER_ID, "Ana Ruiz");

    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startupId: STARTUP_ID,
          deletedAt: null,
          conversation: { members: { some: { memberId: MEMBER_ID } }, archivedAt: null },
        }),
      }),
    );
  });

  it("keys the membership filter on the caller's own member id, not the message sender's", async () => {
    (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);

    await service.searchMessages(STARTUP_ID, OTHER_MEMBER_ID, "confidential");

    const { where } = (mockPrisma.message.findMany as jest.Mock).mock.calls[0][0];
    expect(where.conversation.members.some.memberId).toBe(OTHER_MEMBER_ID);
  });

  it("excludes soft-deleted messages and archived conversations", async () => {
    (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
    await service.searchMessages(STARTUP_ID, MEMBER_ID, "term sheet");
    const { where } = (mockPrisma.message.findMany as jest.Mock).mock.calls[0][0];
    expect(where.deletedAt).toBeNull();
    expect(where.conversation.archivedAt).toBeNull();
  });

  it("caps results at 30 and truncates long messages to 400 characters", async () => {
    const longBody = "x".repeat(1000);
    (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([
      { id: "m-1", conversationId: CONVERSATION_ID, body: longBody, createdAt: new Date(), conversation: { type: "channel", name: "fundraising" }, sender: { user: { firstName: "Ana", lastName: "Ruiz" } } },
    ]);

    const result = await service.searchMessages(STARTUP_ID, MEMBER_ID, "x", 500);

    expect((mockPrisma.message.findMany as jest.Mock).mock.calls[0][0].take).toBe(30);
    expect(result.data[0].excerpt.length).toBe(401); // 400 chars + ellipsis
    expect(result.data[0].sender).toBe("Ana Ruiz");
    expect(result.data[0].conversationName).toBe("fundraising");
  });

  it("labels a DM generically rather than naming the other participant", async () => {
    (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([
      { id: "m-1", conversationId: CONVERSATION_ID, body: "hey", createdAt: new Date(), conversation: { type: "dm", name: null }, sender: { user: { firstName: "Ana", lastName: "Ruiz" } } },
    ]);
    const result = await service.searchMessages(STARTUP_ID, MEMBER_ID, "hey");
    expect(result.data[0].conversationName).toBe("Direct message");
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
      conversation: { startupId: "other-startup", name: "general", type: "channel" },
    });

    await expect(
      service.listMessages(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, { limit: 50 } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "CONVERSATION_NOT_FOUND" });
  });

  it("returns messages oldest-first despite fetching newest-first, top-level only", async () => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: STARTUP_ID, name: "general", type: "channel" },
    });
    const newer = messageRow({ id: "msg-2", seq: BigInt(2) });
    const older = messageRow({ id: "msg-1", seq: BigInt(1) });
    (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([newer, older]);

    const result = await service.listMessages(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, {
      limit: 50,
    } as never);

    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ parentMessageId: null }) }),
    );
    expect(result.data.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
    // BigInt seq serializes to a decimal string on the wire.
    expect(result.data[0].seq).toBe("1");
  });
});

describe("ChatService.listReplies", () => {
  beforeEach(() => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: STARTUP_ID, name: "general", type: "channel" },
    });
  });

  it("404s when the parent message does not exist in this conversation", async () => {
    (mockPrisma.message.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.listReplies(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, PARENT_MESSAGE_ID, 100),
    ).rejects.toMatchObject({ statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  });

  it("returns the parent and its replies oldest-first", async () => {
    (mockPrisma.message.findFirst as jest.Mock).mockResolvedValue(
      messageRow({ id: PARENT_MESSAGE_ID, replyCount: 2 }),
    );
    (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([
      messageRow({ id: "reply-1", seq: BigInt(2), parentMessageId: PARENT_MESSAGE_ID }),
      messageRow({ id: "reply-2", seq: BigInt(3), parentMessageId: PARENT_MESSAGE_ID }),
    ]);

    const result = await service.listReplies(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, PARENT_MESSAGE_ID, 100);

    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parentMessageId: PARENT_MESSAGE_ID, deletedAt: null },
        orderBy: { seq: "asc" },
      }),
    );
    expect(result.data.parent.id).toBe(PARENT_MESSAGE_ID);
    expect(result.data.replies.map((r) => r.id)).toEqual(["reply-1", "reply-2"]);
  });
});

describe("ChatService.sendMessage", () => {
  beforeEach(() => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: STARTUP_ID, name: "general", type: "channel" },
    });
    (mockPrisma.conversationMember.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("rejects a new message when the channel is archived", async () => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: {
        startupId: STARTUP_ID,
        name: "general",
        type: "channel",
        archivedAt: new Date("2026-01-02"),
      },
    });
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, ROLE_ID, {
        body: "should not send",
        clientNonce: "nonce-archived",
      } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: "CONVERSATION_ARCHIVED" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates a message, bumps lastMessageAt, advances the sender's own read pointer, and publishes to other members only", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    const tx = mockTransaction();
    (mockPrisma.conversationMember.findMany as jest.Mock).mockResolvedValue([
      { member: { userId: OTHER_USER_ID } },
      { member: { userId: null } }, // pending invite no open tab to reach
    ]);

    const result = await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, ROLE_ID, {
      body: "hello",
      clientNonce: "nonce-1",
    } as never);

    expect(tx.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startupId: STARTUP_ID,
          conversationId: CONVERSATION_ID,
          senderId: MEMBER_ID,
          body: "hello",
          parentMessageId: null,
        }),
      }),
    );
    expect(tx.conversationMember.update).toHaveBeenCalledWith({
      where: { conversationId_memberId: { conversationId: CONVERSATION_ID, memberId: MEMBER_ID } },
      data: { lastReadSeq: BigInt(1), lastReadAt: expect.any(Date) },
    });
    expect(tx.messageMention.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.conversationMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: CONVERSATION_ID, memberId: { not: MEMBER_ID } },
      }),
    );
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(
      OTHER_USER_ID,
      expect.objectContaining({
        type: "chat.message.created",
        conversationId: CONVERSATION_ID,
        parentMessageId: null,
      }),
    );
    expect(result.data.id).toBe(MESSAGE_ID);
  });

  it("returns the original row on a retried send instead of creating a duplicate", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(messageRow());

    const result = await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, ROLE_ID, {
      body: "hello",
      clientNonce: "nonce-1",
    } as never);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(result.data.id).toBe(MESSAGE_ID);
  });

  it("persists a mention row for a valid reference and notifies the mentioned member", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([{ id: DEAL_ID }]);
    // Same mock backs both the existence check (`id`) and the notify lookup
    // (`userId`) two different callers of startupMember.findMany select
    // different fields, so include both here rather than distinguishing calls.
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([
      { id: OTHER_MEMBER_ID, userId: OTHER_USER_ID, conversationMemberships: [{ notifyLevel: "all" }] },
    ]);
    const body = `check @[Sequoia Seed](deal:${DEAL_ID}) and @[Maya](member:${OTHER_MEMBER_ID})`;
    const tx = mockTransaction({
      message: {
        create: jest.fn().mockResolvedValue(messageRow({ body })),
        update: jest.fn().mockResolvedValue(messageRow()),
      },
    });
    (mockPrisma.message.findUniqueOrThrow as jest.Mock).mockResolvedValue(messageRow({ body }));

    await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, ROLE_ID, {
      body,
      clientNonce: "nonce-1",
    } as never);

    expect(tx.messageMention.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ targetType: "deal", pipelineId: DEAL_ID }),
        expect.objectContaining({ targetType: "member", mentionedMemberId: OTHER_MEMBER_ID }),
      ]),
    });
    expect(mockNotifyMention).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER_USER_ID, startupId: STARTUP_ID, conversationName: "general" }),
    );
  });

  it("drops a mention whose target does not exist in this startup, without failing the send", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]); // stale/cross-tenant id not found
    const tx = mockTransaction();

    const result = await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, ROLE_ID, {
      body: `check @[Sequoia Seed](deal:${DEAL_ID})`,
      clientNonce: "nonce-1",
    } as never);

    expect(tx.messageMention.createMany).not.toHaveBeenCalled();
    expect(result.data.id).toBe(MESSAGE_ID);
  });

  it("does not notify a self-mention", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([
      { id: MEMBER_ID, userId: USER_ID, conversationMemberships: [] },
    ]);
    const tx = mockTransaction();
    (mockPrisma.message.findUniqueOrThrow as jest.Mock).mockResolvedValue(messageRow());

    await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, ROLE_ID, {
      body: `@[Me](member:${MEMBER_ID}) will do it`,
      clientNonce: "nonce-1",
    } as never);

    // The token is still real and valid self-mentioning is harmless, so the
    // mention row is written. Only the notification is suppressed.
    expect(tx.messageMention.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ targetType: "member", mentionedMemberId: MEMBER_ID })],
    });
    expect(mockNotifyMention).not.toHaveBeenCalled();
  });

  it("suppresses the mention notification when the mentioned member has fully muted the conversation", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([
      { id: OTHER_MEMBER_ID, userId: OTHER_USER_ID, conversationMemberships: [{ notifyLevel: "none" }] },
    ]);
    const tx = mockTransaction();
    (mockPrisma.message.findUniqueOrThrow as jest.Mock).mockResolvedValue(messageRow());

    await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, ROLE_ID, {
      body: `@[Maya](member:${OTHER_MEMBER_ID}) heads up`,
      clientNonce: "nonce-1",
    } as never);

    expect(tx.messageMention.createMany).toHaveBeenCalled();
    expect(mockNotifyMention).not.toHaveBeenCalled();
  });

  it("re-parents a reply-to-a-reply onto the original top-level ancestor and increments its replyCount", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    // The named parent is itself a reply its own parentMessageId points at
    // the true top-level ancestor.
    (mockPrisma.message.findFirst as jest.Mock).mockResolvedValue({
      id: "some-reply",
      parentMessageId: PARENT_MESSAGE_ID,
    });
    const tx = mockTransaction();

    await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, ROLE_ID, {
      body: "following up",
      clientNonce: "nonce-1",
      parentMessageId: "some-reply",
    } as never);

    expect(tx.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentMessageId: PARENT_MESSAGE_ID }) }),
    );
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: PARENT_MESSAGE_ID },
      data: { replyCount: { increment: 1 } },
    });
  });

  it("404s when replying to a message that doesn't exist in this conversation", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.message.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, ROLE_ID, {
        body: "following up",
        clientNonce: "nonce-1",
        parentMessageId: PARENT_MESSAGE_ID,
      } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  });

  it("attaches a vault document when the caller can read documents", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.rolePermission.findMany as jest.Mock).mockResolvedValue([
      { permission: { resource: "documents" } },
    ]);
    (mockPrisma.document.findMany as jest.Mock).mockResolvedValue([{ id: DOCUMENT_ID }]);
    const tx = mockTransaction();
    (mockPrisma.message.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      messageRow({ attachments: [{ document: { id: DOCUMENT_ID, title: "Deck", documentType: "deck" } }] }),
    );

    const result = await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, ROLE_ID, {
      body: "see attached",
      clientNonce: "nonce-1",
      documentIds: [DOCUMENT_ID],
    } as never);

    expect(tx.messageAttachment.createMany).toHaveBeenCalledWith({
      data: [{ startupId: STARTUP_ID, messageId: MESSAGE_ID, documentId: DOCUMENT_ID }],
    });
    expect(result.data.attachments).toEqual([
      { documentId: DOCUMENT_ID, title: "Deck", documentType: "deck" },
    ]);
  });

  it("silently drops an attachment when the caller cannot read documents", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.rolePermission.findMany as jest.Mock).mockResolvedValue([]); // no documents:read
    const tx = mockTransaction();

    await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, ROLE_ID, {
      body: "see attached",
      clientNonce: "nonce-1",
      documentIds: [DOCUMENT_ID],
    } as never);

    expect(mockPrisma.document.findMany).not.toHaveBeenCalled();
    expect(tx.messageAttachment.createMany).not.toHaveBeenCalled();
  });
});

describe("ChatService.toggleReaction", () => {
  it("404s when the message does not exist in this startup", async () => {
    (mockPrisma.message.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.toggleReaction(STARTUP_ID, MESSAGE_ID, MEMBER_ID, "👍"),
    ).rejects.toMatchObject({ statusCode: 404, code: "MESSAGE_NOT_FOUND" });
  });

  it("adds the reaction when the member hasn't reacted with that emoji yet", async () => {
    (mockPrisma.message.findFirst as jest.Mock).mockResolvedValue({ id: MESSAGE_ID, conversationId: CONVERSATION_ID });
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: STARTUP_ID, name: "general", type: "channel" },
    });
    (mockPrisma.messageReaction.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.messageReaction.findMany as jest.Mock).mockResolvedValue([
      { emoji: "👍", memberId: MEMBER_ID },
    ]);
    (mockPrisma.conversationMember.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.toggleReaction(STARTUP_ID, MESSAGE_ID, MEMBER_ID, "👍");

    expect(mockPrisma.messageReaction.create).toHaveBeenCalledWith({
      data: { startupId: STARTUP_ID, messageId: MESSAGE_ID, memberId: MEMBER_ID, emoji: "👍" },
    });
    expect(mockPrisma.messageReaction.delete).not.toHaveBeenCalled();
    expect(result.data.reactions).toEqual([{ emoji: "👍", count: 1, reactedByMe: true }]);
  });

  it("removes the reaction on a second toggle", async () => {
    (mockPrisma.message.findFirst as jest.Mock).mockResolvedValue({ id: MESSAGE_ID, conversationId: CONVERSATION_ID });
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: STARTUP_ID, name: "general", type: "channel" },
    });
    (mockPrisma.messageReaction.findUnique as jest.Mock).mockResolvedValue({ id: "reaction-1" });
    (mockPrisma.messageReaction.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.conversationMember.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.toggleReaction(STARTUP_ID, MESSAGE_ID, MEMBER_ID, "👍");

    expect(mockPrisma.messageReaction.delete).toHaveBeenCalledWith({ where: { id: "reaction-1" } });
    expect(mockPrisma.messageReaction.create).not.toHaveBeenCalled();
    expect(result.data.reactions).toEqual([]);
  });
});

describe("ChatService.markRead", () => {
  beforeEach(() => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: STARTUP_ID, name: "general", type: "channel" },
    });
  });

  /**
   * conversationMember.findUnique backs two different callers here —
   * verifyMembership's own-row-with-conversation lookup, and markRead's
   * read-back of the stored pointer afterward so branch on the `select`
   * shape rather than a single mockResolvedValue that would answer both alike.
   */
  function mockOwnLastReadSeq(lastReadSeq: bigint) {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockImplementation(
      (args: { select?: { conversation?: unknown } }) =>
        args.select?.conversation
          ? Promise.resolve({
              id: "membership-1",
              conversation: { startupId: STARTUP_ID, name: "general", type: "channel" },
            })
          : Promise.resolve({ lastReadSeq }),
    );
  }

  it("advances lastReadSeq to the latest top-level message", async () => {
    (mockPrisma.message.findFirst as jest.Mock).mockResolvedValue({ seq: BigInt(42) });
    mockOwnLastReadSeq(BigInt(42));

    const result = await service.markRead(STARTUP_ID, CONVERSATION_ID, MEMBER_ID);

    expect(mockPrisma.conversationMember.updateMany).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        memberId: MEMBER_ID,
        OR: [{ lastReadSeq: null }, { lastReadSeq: { lt: BigInt(42) } }],
      },
      data: { lastReadSeq: BigInt(42), lastReadAt: expect.any(Date) },
    });
    expect(result.data.lastReadSeq).toBe("42");
  });

  it("reports the caller's actual stored pointer, not the top-level latest, when it was already advanced further (e.g. by their own send of a reply)", async () => {
    (mockPrisma.message.findFirst as jest.Mock).mockResolvedValue({ seq: BigInt(12) }); // latest top-level message
    // The stored pointer is already ahead e.g. sendMessage advanced it to
    // a reply's seq (13), which isn't itself a top-level message.
    mockOwnLastReadSeq(BigInt(13));

    const result = await service.markRead(STARTUP_ID, CONVERSATION_ID, MEMBER_ID);

    expect(result.data.lastReadSeq).toBe("13");
  });

  it("no-ops when the room has no messages yet", async () => {
    (mockPrisma.message.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await service.markRead(STARTUP_ID, CONVERSATION_ID, MEMBER_ID);

    expect(mockPrisma.conversationMember.updateMany).not.toHaveBeenCalled();
    expect(result.data.lastReadSeq).toBeNull();
  });
});

describe("ChatService.setNotifyLevel", () => {
  it("updates the caller's own membership row", async () => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: STARTUP_ID, name: "general", type: "channel" },
    });

    const result = await service.setNotifyLevel(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, "none");

    expect(mockPrisma.conversationMember.update).toHaveBeenCalledWith({
      where: { conversationId_memberId: { conversationId: CONVERSATION_ID, memberId: MEMBER_ID } },
      data: { notifyLevel: "none" },
    });
    expect(result.data.notifyLevel).toBe("none");
  });
});

describe("ChatService.notifyTyping", () => {
  it("pings every other member's open tabs, not the caller's own", async () => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: STARTUP_ID, name: "general", type: "channel" },
    });
    (mockPrisma.startupMember.findUnique as jest.Mock).mockResolvedValue({
      user: { firstName: "Ada", lastName: "Lovelace" },
    });
    (mockPrisma.conversationMember.findMany as jest.Mock).mockResolvedValue([
      { member: { userId: OTHER_USER_ID } },
    ]);

    await service.notifyTyping(STARTUP_ID, CONVERSATION_ID, MEMBER_ID);

    expect(mockPublish).toHaveBeenCalledWith(
      OTHER_USER_ID,
      expect.objectContaining({
        type: "chat.typing",
        conversationId: CONVERSATION_ID,
        memberId: MEMBER_ID,
        memberName: "Ada Lovelace",
      }),
    );
  });
});

describe("ChatService.searchMentionables", () => {
  it("excludes types the caller's role cannot read", async () => {
    (mockPrisma.rolePermission.findMany as jest.Mock).mockResolvedValue([]); // no pipeline/financial/documents read
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.searchMentionables(STARTUP_ID, ROLE_ID, {
      q: "sequoia",
      types: undefined,
    } as never);

    // "member" is the only type search still runs without pipeline:read —
    // chat:read alone is enough to @-mention a teammate.
    expect(mockPrisma.startupInvestor.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.pipeline.findMany).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
  });

  it("searches deals when the role holds pipeline:read", async () => {
    (mockPrisma.rolePermission.findMany as jest.Mock).mockResolvedValue([
      { permission: { resource: "pipeline" } },
    ]);
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([
      {
        id: DEAL_ID,
        startupInvestor: { fullName: "Sequoia Capital" },
        round: { roundName: "Seed" },
      },
    ]);

    const result = await service.searchMentionables(STARTUP_ID, ROLE_ID, {
      q: "sequoia",
      types: ["deal"],
    } as never);

    expect(result.data).toEqual([
      { type: "deal", id: DEAL_ID, label: "Sequoia Capital", sublabel: "Seed" },
    ]);
  });

  it("returns nothing for a blank query", async () => {
    (mockPrisma.rolePermission.findMany as jest.Mock).mockResolvedValue([
      { permission: { resource: "pipeline" } },
    ]);

    const result = await service.searchMentionables(STARTUP_ID, ROLE_ID, {
      q: "",
      types: undefined,
    } as never);

    expect(result.data).toEqual([]);
    expect(mockPrisma.startupInvestor.findMany).not.toHaveBeenCalled();
  });
});

describe("ChatService.resolveMentions", () => {
  it("omits a type the caller cannot read rather than erroring", async () => {
    (mockPrisma.rolePermission.findMany as jest.Mock).mockResolvedValue([]); // no financial:read

    const result = await service.resolveMentions(STARTUP_ID, ROLE_ID, [
      { type: "round", id: "round-1" },
    ] as never);

    expect(mockPrisma.fundraisingRound.findMany).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
  });

  it("hides expectedAmount on a resolved deal without financial:read", async () => {
    (mockPrisma.rolePermission.findMany as jest.Mock).mockResolvedValue([
      { permission: { resource: "pipeline" } }, // deal visible, financial is not
    ]);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([
      {
        id: DEAL_ID,
        stage: "term_sheet",
        isLead: true,
        expectedAmount: new Prisma.Decimal(250000),
        startupInvestor: { fullName: "Sequoia Capital" },
        round: { roundName: "Seed", currency: "USD" },
        owner: null,
      },
    ]);

    const result = await service.resolveMentions(STARTUP_ID, ROLE_ID, [
      { type: "deal", id: DEAL_ID },
    ] as never);

    expect(result.data).toEqual([
      expect.objectContaining({ type: "deal", id: DEAL_ID, expectedAmount: null }),
    ]);
  });

  it("includes expectedAmount on a resolved deal with financial:read", async () => {
    (mockPrisma.rolePermission.findMany as jest.Mock).mockResolvedValue([
      { permission: { resource: "pipeline" } },
      { permission: { resource: "financial" } },
    ]);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([
      {
        id: DEAL_ID,
        stage: "term_sheet",
        isLead: true,
        expectedAmount: new Prisma.Decimal(250000),
        startupInvestor: { fullName: "Sequoia Capital" },
        round: { roundName: "Seed", currency: "USD" },
        owner: null,
      },
    ]);

    const result = await service.resolveMentions(STARTUP_ID, ROLE_ID, [
      { type: "deal", id: DEAL_ID },
    ] as never);

    expect(result.data).toEqual([expect.objectContaining({ expectedAmount: 250000 })]);
  });
});

describe("ChatService.getMentionsForTarget", () => {
  it("403s when the caller's role cannot read that target type", async () => {
    (mockPrisma.rolePermission.findMany as jest.Mock).mockResolvedValue([]); // no financial:read

    await expect(
      service.getMentionsForTarget(STARTUP_ID, MEMBER_ID, ROLE_ID, "round", "round-1", 20),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mockPrisma.messageMention.findMany).not.toHaveBeenCalled();
  });

  it("scopes the backlink query to the target, the startup, and the caller's own conversations", async () => {
    (mockPrisma.rolePermission.findMany as jest.Mock).mockResolvedValue([
      { permission: { resource: "pipeline" } },
    ]);
    (mockPrisma.messageMention.findMany as jest.Mock).mockResolvedValue([
      {
        id: "mention-1",
        createdAt: new Date("2026-01-02"),
        conversation: { id: CONVERSATION_ID, name: "general" },
        message: messageRow(),
      },
    ]);

    const result = await service.getMentionsForTarget(
      STARTUP_ID,
      MEMBER_ID,
      ROLE_ID,
      "deal",
      DEAL_ID,
      20,
    );

    expect(mockPrisma.messageMention.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startupId: STARTUP_ID,
          targetType: "deal",
          pipelineId: DEAL_ID,
          conversation: { members: { some: { memberId: MEMBER_ID } } },
        }),
      }),
    );
    expect(result.data).toEqual([
      expect.objectContaining({ conversationId: CONVERSATION_ID, conversationName: "general" }),
    ]);
  });
});
