import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { realtimeBus } from "../events/realtime-bus";
import type {
  CreateConversationInput,
  SendMessageInput,
  ListMessagesQuery,
} from "../validators/chat.schemas";

const CONVERSATION_SELECT = {
  id: true,
  startupId: true,
  name: true,
  topic: true,
  lastMessageAt: true,
  archivedAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

const MESSAGE_SELECT = {
  id: true,
  startupId: true,
  conversationId: true,
  seq: true,
  senderId: true,
  body: true,
  clientNonce: true,
  editedAt: true,
  deletedAt: true,
  createdAt: true,
  sender: {
    select: {
      id: true,
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    },
  },
} as const;

type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof CONVERSATION_SELECT }>;
type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

function serializeConversation(row: ConversationRow) {
  return { ...row };
}

function serializeMessage(row: MessageRow) {
  return {
    id: row.id,
    startupId: row.startupId,
    conversationId: row.conversationId,
    // BigInt has no JSON representation — the wire format is a decimal
    // string, which listMessagesQuerySchema's `before` field reads back in.
    seq: row.seq.toString(),
    senderId: row.senderId,
    sender: row.sender
      ? {
          id: row.sender.id,
          firstName: row.sender.user?.firstName ?? null,
          lastName: row.sender.user?.lastName ?? null,
          avatarUrl: row.sender.user?.avatarUrl ?? null,
        }
      : null,
    body: row.body,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  };
}

export class ChatService {
  /**
   * Phase 1 channels are workspace-wide: every active member is added at
   * creation time, since there is no invite-to-channel UI yet. Selective
   * membership (private channels, DMs) is additive later — see the schema
   * comment above the Conversation model.
   */
  async createConversation(startupId: string, input: CreateConversationInput, actorUserId: string) {
    const activeMembers = await prisma.startupMember.findMany({
      where: { startupId, status: "active" },
      select: { id: true },
    });

    try {
      const conversation = await prisma.conversation.create({
        data: {
          startupId,
          name: input.name,
          topic: input.topic ?? null,
          createdBy: actorUserId,
          // startupId is deliberately omitted here — ConversationMember's
          // `conversation` relation shares that scalar with its `member`
          // relation (both are part of composite FKs), so Prisma fills it in
          // from the parent Conversation being created; passing it explicitly
          // is rejected as an unknown argument in this nested-write context.
          members: {
            create: activeMembers.map((member) => ({ memberId: member.id })),
          },
        },
        select: CONVERSATION_SELECT,
      });

      return { data: serializeConversation(conversation) };
    } catch (err) {
      throw this.translateDuplicateName(err);
    }
  }

  /** Channels the caller belongs to, most recently active first. */
  async listConversations(startupId: string, memberId: string) {
    const rows = await prisma.conversation.findMany({
      where: { startupId, archivedAt: null, members: { some: { memberId } } },
      select: CONVERSATION_SELECT,
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    });

    return { data: rows.map(serializeConversation) };
  }

  private async requireMembership(
    startupId: string,
    conversationId: string,
    memberId: string,
  ): Promise<void> {
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_memberId: { conversationId, memberId } },
      select: { id: true, conversation: { select: { startupId: true } } },
    });
    if (!membership || membership.conversation.startupId !== startupId) {
      throw createError("Conversation not found", 404, "CONVERSATION_NOT_FOUND");
    }
  }

  async listMessages(
    startupId: string,
    conversationId: string,
    memberId: string,
    query: ListMessagesQuery,
  ) {
    await this.requireMembership(startupId, conversationId, memberId);

    const rows = await prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        ...(query.before && { seq: { lt: BigInt(query.before) } }),
      },
      select: MESSAGE_SELECT,
      orderBy: { seq: "desc" },
      take: query.limit,
    });

    // Fetched newest-first for the LIMIT to bite the right end of the room;
    // returned oldest-first, which is the order a message list renders in.
    return { data: rows.reverse().map(serializeMessage) };
  }

  /**
   * Every member's userId, for live fan-out. Excludes members who are only a
   * pending invite (no linked user yet) — there is no open tab to reach.
   */
  private async memberUserIds(conversationId: string, excludingMemberId: string): Promise<string[]> {
    const rows = await prisma.conversationMember.findMany({
      where: { conversationId, memberId: { not: excludingMemberId } },
      select: { member: { select: { userId: true } } },
    });
    return rows
      .map((row) => row.member.userId)
      .filter((userId): userId is string => userId !== null);
  }

  async sendMessage(
    startupId: string,
    conversationId: string,
    memberId: string,
    input: SendMessageInput,
  ) {
    await this.requireMembership(startupId, conversationId, memberId);

    // Retried POST with the same nonce resolves to the original row instead
    // of creating a duplicate — the unique constraint is the source of truth,
    // this lookup just avoids a needless failed-insert round trip.
    const existing = await prisma.message.findUnique({
      where: { conversationId_clientNonce: { conversationId, clientNonce: input.clientNonce } },
      select: MESSAGE_SELECT,
    });
    if (existing) return { data: serializeMessage(existing) };

    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          startupId,
          conversationId,
          senderId: memberId,
          body: input.body,
          clientNonce: input.clientNonce,
        },
        select: MESSAGE_SELECT,
      }),
      prisma.conversation.update({
        where: { startupId_id: { startupId, id: conversationId } },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    const serialized = serializeMessage(message);

    // Chat volume does not belong on the notification bell — this is a live
    // signal for whoever already has the room open, not a persisted
    // Notification row. Mention-driven notifications arrive in a later phase.
    const recipientUserIds = await this.memberUserIds(conversationId, memberId);
    for (const userId of recipientUserIds) {
      realtimeBus.publish(userId, {
        type: "chat.message.created",
        conversationId,
        messageId: message.id,
        seq: serialized.seq,
      });
    }

    return { data: serialized };
  }

  private translateDuplicateName(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return createError("A channel with this name already exists", 409, "CONVERSATION_NAME_TAKEN");
    }
    return err;
  }
}

export const chatService = new ChatService();
