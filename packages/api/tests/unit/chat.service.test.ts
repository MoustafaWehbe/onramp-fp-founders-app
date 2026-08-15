import { Prisma } from "@prisma/client";
import { ChatService } from "../../src/services/chat.service";

jest.mock("../../src/db/prisma", () => ({
  prisma: {
    startupMember: { findMany: jest.fn() },
    startupInvestor: { findMany: jest.fn() },
    pipeline: { findMany: jest.fn() },
    task: { findMany: jest.fn() },
    fundraisingRound: { findMany: jest.fn() },
    document: { findMany: jest.fn() },
    rolePermission: { findMany: jest.fn() },
    messageMention: { findMany: jest.fn() },
    conversation: { create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    conversationMember: { findUnique: jest.fn(), findMany: jest.fn() },
    message: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
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

/** Wires $transaction to invoke the callback with a tx stub, capturing what was written. */
function mockTransaction(overrides: Record<string, unknown> = {}) {
  const tx = {
    message: { create: jest.fn().mockResolvedValue(messageRow()) },
    conversation: { update: jest.fn().mockResolvedValue(conversationRow()) },
    messageMention: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
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
      conversation: { startupId: "other-startup", name: "general" },
    });

    await expect(
      service.listMessages(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, { limit: 50 } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "CONVERSATION_NOT_FOUND" });
  });

  it("returns messages oldest-first despite fetching newest-first", async () => {
    (mockPrisma.conversationMember.findUnique as jest.Mock).mockResolvedValue({
      id: "membership-1",
      conversation: { startupId: STARTUP_ID, name: "general" },
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
      conversation: { startupId: STARTUP_ID, name: "general" },
    });
    (mockPrisma.conversationMember.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("creates a message, bumps lastMessageAt, and publishes to other members only", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    const tx = mockTransaction();
    (mockPrisma.conversationMember.findMany as jest.Mock).mockResolvedValue([
      { member: { userId: OTHER_USER_ID } },
      { member: { userId: null } }, // pending invite — no open tab to reach
    ]);

    const result = await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, {
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
        }),
      }),
    );
    expect(tx.messageMention.createMany).not.toHaveBeenCalled();
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

  it("persists a mention row for a valid reference and notifies the mentioned member", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([{ id: DEAL_ID }]);
    // Same mock backs both the existence check (`id`) and the notify lookup
    // (`userId`) — two different callers of startupMember.findMany select
    // different fields, so include both here rather than distinguishing calls.
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([
      { id: OTHER_MEMBER_ID, userId: OTHER_USER_ID },
    ]);
    const tx = mockTransaction({
      message: {
        create: jest.fn().mockResolvedValue(
          messageRow({ body: `check @[Sequoia — Seed](deal:${DEAL_ID}) and @[Maya](member:${OTHER_MEMBER_ID})` }),
        ),
      },
    });

    await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, {
      body: `check @[Sequoia — Seed](deal:${DEAL_ID}) and @[Maya](member:${OTHER_MEMBER_ID})`,
      clientNonce: "nonce-1",
    } as never);

    expect(tx.messageMention.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ targetType: "deal", pipelineId: DEAL_ID }),
        expect.objectContaining({ targetType: "member", mentionedMemberId: OTHER_MEMBER_ID }),
      ]),
    });
    expect(mockNotifyMention).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER_USER_ID, startupId: STARTUP_ID }),
    );
  });

  it("drops a mention whose target does not exist in this startup, without failing the send", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.pipeline.findMany as jest.Mock).mockResolvedValue([]); // stale/cross-tenant id — not found
    const tx = mockTransaction();

    const result = await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, {
      body: `check @[Sequoia — Seed](deal:${DEAL_ID})`,
      clientNonce: "nonce-1",
    } as never);

    expect(tx.messageMention.createMany).not.toHaveBeenCalled();
    expect(result.data.id).toBe(MESSAGE_ID);
  });

  it("does not notify a self-mention", async () => {
    (mockPrisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.startupMember.findMany as jest.Mock).mockResolvedValue([{ id: MEMBER_ID }]);
    const tx = mockTransaction();

    await service.sendMessage(STARTUP_ID, CONVERSATION_ID, MEMBER_ID, {
      body: `@[Me](member:${MEMBER_ID}) will do it`,
      clientNonce: "nonce-1",
    } as never);

    // The token is still real and valid — self-mentioning is harmless, so the
    // mention row is written. Only the notification is suppressed.
    expect(tx.messageMention.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ targetType: "member", mentionedMemberId: MEMBER_ID })],
    });
    expect(mockNotifyMention).not.toHaveBeenCalled();
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
