import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { realtimeBus } from "../events/realtime-bus";
import { notificationService } from "./notification.service";
import {
  MENTION_TARGET_TYPES,
  parseMentions,
  toPlainExcerpt,
  type MentionTargetType,
  type ParsedMention,
} from "../utils/mentions";
import type {
  CreateConversationInput,
  SendMessageInput,
  ListMessagesQuery,
  MentionableQuery,
  ResolveMentionsInput,
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

/** Resource permission (read) that gates searching/resolving/backlinking each mention type. */
const TYPE_PERMISSION_RESOURCE: Record<MentionTargetType, string | null> = {
  member: null, // chat:read already gates the whole endpoint
  investor: "pipeline",
  deal: "pipeline",
  task: "pipeline",
  round: "financial",
  document: "documents",
};

function mentionTargetWhere(type: MentionTargetType, id: string): Prisma.MessageMentionWhereInput {
  switch (type) {
    case "member":
      return { mentionedMemberId: id };
    case "investor":
      return { investorId: id };
    case "deal":
      return { pipelineId: id };
    case "task":
      return { taskId: id };
    case "round":
      return { roundId: id };
    case "document":
      return { documentId: id };
  }
}

function mentionCreateColumns(mention: ParsedMention): Pick<
  Prisma.MessageMentionCreateManyInput,
  "mentionedMemberId" | "investorId" | "pipelineId" | "taskId" | "roundId" | "documentId"
> {
  switch (mention.type) {
    case "member":
      return { mentionedMemberId: mention.id };
    case "investor":
      return { investorId: mention.id };
    case "deal":
      return { pipelineId: mention.id };
    case "task":
      return { taskId: mention.id };
    case "round":
      return { roundId: mention.id };
    case "document":
      return { documentId: mention.id };
  }
}

export type MentionableItem = {
  type: MentionTargetType;
  id: string;
  label: string;
  sublabel: string | null;
};

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

  private async verifyMembership(
    startupId: string,
    conversationId: string,
    memberId: string,
  ): Promise<{ conversationName: string }> {
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_memberId: { conversationId, memberId } },
      select: { id: true, conversation: { select: { startupId: true, name: true } } },
    });
    if (!membership || membership.conversation.startupId !== startupId) {
      throw createError("Conversation not found", 404, "CONVERSATION_NOT_FOUND");
    }
    return { conversationName: membership.conversation.name };
  }

  async listMessages(
    startupId: string,
    conversationId: string,
    memberId: string,
    query: ListMessagesQuery,
  ) {
    await this.verifyMembership(startupId, conversationId, memberId);

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

  /**
   * Drops any parsed token whose target does not actually exist in this
   * startup — a stale reference (the target was deleted between the picker
   * opening and the send) or a crafted token degrades to plain unlinked text
   * rather than failing the whole send. Scoping every lookup by startupId is
   * also what stops a crafted token from linking into another tenant's row.
   */
  private async filterValidMentions(
    startupId: string,
    mentions: ParsedMention[],
  ): Promise<ParsedMention[]> {
    if (mentions.length === 0) return [];

    const idsByType = new Map<MentionTargetType, string[]>();
    for (const mention of mentions) {
      const list = idsByType.get(mention.type) ?? [];
      list.push(mention.id);
      idsByType.set(mention.type, list);
    }

    const validIdsByType = new Map<MentionTargetType, Set<string>>();
    await Promise.all(
      [...idsByType.entries()].map(async ([type, ids]) => {
        validIdsByType.set(type, await this.existingTargetIds(type, startupId, ids));
      }),
    );

    return mentions.filter((mention) => validIdsByType.get(mention.type)?.has(mention.id));
  }

  private async existingTargetIds(
    type: MentionTargetType,
    startupId: string,
    ids: string[],
  ): Promise<Set<string>> {
    switch (type) {
      case "member": {
        const rows = await prisma.startupMember.findMany({
          where: { startupId, id: { in: ids }, status: "active" },
          select: { id: true },
        });
        return new Set(rows.map((r) => r.id));
      }
      case "investor": {
        const rows = await prisma.startupInvestor.findMany({
          where: { startupId, id: { in: ids } },
          select: { id: true },
        });
        return new Set(rows.map((r) => r.id));
      }
      case "deal": {
        const rows = await prisma.pipeline.findMany({
          where: { startupId, id: { in: ids } },
          select: { id: true },
        });
        return new Set(rows.map((r) => r.id));
      }
      case "task": {
        const rows = await prisma.task.findMany({
          where: { startupId, id: { in: ids } },
          select: { id: true },
        });
        return new Set(rows.map((r) => r.id));
      }
      case "round": {
        const rows = await prisma.fundraisingRound.findMany({
          where: { startupId, id: { in: ids } },
          select: { id: true },
        });
        return new Set(rows.map((r) => r.id));
      }
      case "document": {
        const rows = await prisma.document.findMany({
          where: { startupId, id: { in: ids } },
          select: { id: true },
        });
        return new Set(rows.map((r) => r.id));
      }
    }
  }

  async sendMessage(
    startupId: string,
    conversationId: string,
    memberId: string,
    input: SendMessageInput,
  ) {
    const { conversationName } = await this.verifyMembership(startupId, conversationId, memberId);

    // Retried POST with the same nonce resolves to the original row instead
    // of creating a duplicate — the unique constraint is the source of truth,
    // this lookup just avoids a needless failed-insert round trip.
    const existing = await prisma.message.findUnique({
      where: { conversationId_clientNonce: { conversationId, clientNonce: input.clientNonce } },
      select: MESSAGE_SELECT,
    });
    if (existing) return { data: serializeMessage(existing) };

    const parsedMentions = parseMentions(input.body);
    const validMentions = await this.filterValidMentions(startupId, parsedMentions);

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          startupId,
          conversationId,
          senderId: memberId,
          body: input.body,
          clientNonce: input.clientNonce,
        },
        select: MESSAGE_SELECT,
      });

      await tx.conversation.update({
        where: { startupId_id: { startupId, id: conversationId } },
        data: { lastMessageAt: new Date() },
      });

      if (validMentions.length > 0) {
        await tx.messageMention.createMany({
          data: validMentions.map((mention) => ({
            startupId,
            messageId: created.id,
            conversationId,
            targetType: mention.type,
            ...mentionCreateColumns(mention),
          })),
        });
      }

      return created;
    });

    const serialized = serializeMessage(message);

    // Chat volume does not belong on the notification bell — this is a live
    // signal for whoever already has the room open, not a persisted
    // Notification row.
    const recipientUserIds = await this.memberUserIds(conversationId, memberId);
    for (const userId of recipientUserIds) {
      realtimeBus.publish(userId, {
        type: "chat.message.created",
        conversationId,
        messageId: message.id,
        seq: serialized.seq,
      });
    }

    // Being @-referenced is different from chat volume — it's addressed to
    // someone specifically, so it does earn a real notification.
    await this.notifyMentionedMembers(startupId, memberId, validMentions, {
      messageId: message.id,
      conversationName,
      senderName: this.senderDisplayName(serialized.sender),
      excerpt: toPlainExcerpt(input.body),
    });

    return { data: serialized };
  }

  private senderDisplayName(sender: { firstName: string | null; lastName: string | null } | null): string {
    if (!sender) return "Someone";
    const name = `${sender.firstName ?? ""} ${sender.lastName ?? ""}`.trim();
    return name || "A teammate";
  }

  private async notifyMentionedMembers(
    startupId: string,
    senderMemberId: string,
    mentions: ParsedMention[],
    context: { messageId: string; conversationName: string; senderName: string; excerpt: string },
  ): Promise<void> {
    const memberMentionIds = mentions
      .filter((m) => m.type === "member" && m.id !== senderMemberId)
      .map((m) => m.id);
    if (memberMentionIds.length === 0) return;

    const members = await prisma.startupMember.findMany({
      where: { startupId, id: { in: memberMentionIds } },
      select: { userId: true },
    });

    for (const member of members) {
      if (!member.userId) continue;
      void notificationService.notifyMention({
        userId: member.userId,
        startupId,
        messageId: context.messageId,
        senderName: context.senderName,
        conversationName: context.conversationName,
        excerpt: context.excerpt,
      });
    }
  }

  /** Every resource-level read permission the caller's role holds, among the ones mention types are gated on. */
  private async callerReadableResources(roleId: string): Promise<Set<string>> {
    const rows = await prisma.rolePermission.findMany({
      where: {
        roleId,
        permission: { resource: { in: ["pipeline", "financial", "documents"] }, action: "read" },
      },
      select: { permission: { select: { resource: true } } },
    });
    return new Set(rows.map((r) => r.permission.resource));
  }

  private mentionTypesFor(resources: Set<string>): Set<MentionTargetType> {
    const allowed = new Set<MentionTargetType>(["member"]);
    for (const type of MENTION_TARGET_TYPES) {
      const resource = TYPE_PERMISSION_RESOURCE[type];
      if (resource && resources.has(resource)) allowed.add(type);
    }
    return allowed;
  }

  /** Autocomplete across every referenceable entity, permission-filtered server-side. */
  async searchMentionables(startupId: string, roleId: string, query: MentionableQuery) {
    const resources = await this.callerReadableResources(roleId);
    const allowed = this.mentionTypesFor(resources);
    const requestedTypes = query.types && query.types.length > 0 ? query.types : MENTION_TARGET_TYPES;
    const types = requestedTypes.filter((type) => allowed.has(type));

    const q = query.q.trim();
    if (q.length === 0 || types.length === 0) return { data: [] as MentionableItem[] };

    const perType = 6;
    const results = await Promise.all(types.map((type) => this.searchOneType(type, startupId, q, perType)));
    return { data: results.flat() };
  }

  private async searchOneType(
    type: MentionTargetType,
    startupId: string,
    q: string,
    take: number,
  ): Promise<MentionableItem[]> {
    switch (type) {
      case "member": {
        const rows = await prisma.startupMember.findMany({
          where: {
            startupId,
            status: "active",
            user: {
              is: {
                OR: [
                  { firstName: { contains: q, mode: "insensitive" } },
                  { lastName: { contains: q, mode: "insensitive" } },
                ],
              },
            },
          },
          select: { id: true, user: { select: { firstName: true, lastName: true } } },
          take,
        });
        return rows.map((r) => ({
          type,
          id: r.id,
          label: `${r.user?.firstName ?? ""} ${r.user?.lastName ?? ""}`.trim() || "Teammate",
          sublabel: null,
        }));
      }
      case "investor": {
        const rows = await prisma.startupInvestor.findMany({
          where: { startupId, fullName: { contains: q, mode: "insensitive" } },
          select: { id: true, fullName: true, ventureFirm: true },
          take,
        });
        return rows.map((r) => ({ type, id: r.id, label: r.fullName, sublabel: r.ventureFirm }));
      }
      case "deal": {
        const rows = await prisma.pipeline.findMany({
          where: { startupId, startupInvestor: { fullName: { contains: q, mode: "insensitive" } } },
          select: {
            id: true,
            startupInvestor: { select: { fullName: true } },
            round: { select: { roundName: true } },
          },
          take,
        });
        return rows.map((r) => ({
          type,
          id: r.id,
          label: r.startupInvestor.fullName,
          sublabel: r.round.roundName,
        }));
      }
      case "task": {
        const rows = await prisma.task.findMany({
          where: { startupId, title: { contains: q, mode: "insensitive" } },
          select: { id: true, title: true, status: true },
          take,
        });
        return rows.map((r) => ({
          type,
          id: r.id,
          label: r.title,
          sublabel: r.status === "completed" ? "Completed" : "Open",
        }));
      }
      case "round": {
        const rows = await prisma.fundraisingRound.findMany({
          where: { startupId, roundName: { contains: q, mode: "insensitive" } },
          select: { id: true, roundName: true, status: true },
          take,
        });
        return rows.map((r) => ({ type, id: r.id, label: r.roundName, sublabel: r.status }));
      }
      case "document": {
        const rows = await prisma.document.findMany({
          where: { startupId, title: { contains: q, mode: "insensitive" } },
          select: { id: true, title: true, documentType: true },
          take,
        });
        return rows.map((r) => ({ type, id: r.id, label: r.title, sublabel: r.documentType }));
      }
    }
  }

  /**
   * Batch-renders reference chips into unfurl cards. Best-effort: an item the
   * caller cannot read, or that no longer exists, is simply omitted — the
   * client falls back to the token's plain-text label rather than erroring
   * the whole message out.
   */
  async resolveMentions(startupId: string, roleId: string, items: ResolveMentionsInput["items"]) {
    const resources = await this.callerReadableResources(roleId);
    const allowed = this.mentionTypesFor(resources);

    const idsByType = new Map<MentionTargetType, string[]>();
    for (const item of items) {
      if (!allowed.has(item.type)) continue;
      const list = idsByType.get(item.type) ?? [];
      list.push(item.id);
      idsByType.set(item.type, list);
    }

    const results = await Promise.all(
      [...idsByType.entries()].map(([type, ids]) => this.resolveOneType(type, startupId, ids, resources)),
    );

    return { data: results.flat() };
  }

  private async resolveOneType(
    type: MentionTargetType,
    startupId: string,
    ids: string[],
    resources: Set<string>,
  ): Promise<unknown[]> {
    switch (type) {
      case "member": {
        const rows = await prisma.startupMember.findMany({
          where: { startupId, id: { in: ids } },
          select: { id: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        });
        return rows.map((r) => ({
          type,
          id: r.id,
          title: `${r.user?.firstName ?? ""} ${r.user?.lastName ?? ""}`.trim() || "Teammate",
          subtitle: null,
          avatarUrl: r.user?.avatarUrl ?? null,
        }));
      }
      case "investor": {
        const rows = await prisma.startupInvestor.findMany({
          where: { startupId, id: { in: ids } },
          select: { id: true, fullName: true, ventureFirm: true, investorType: true },
        });
        return rows.map((r) => ({
          type,
          id: r.id,
          title: r.fullName,
          subtitle: r.ventureFirm,
          investorType: r.investorType,
        }));
      }
      case "deal": {
        const rows = await prisma.pipeline.findMany({
          where: { startupId, id: { in: ids } },
          select: {
            id: true,
            stage: true,
            isLead: true,
            expectedAmount: true,
            startupInvestor: { select: { fullName: true } },
            round: { select: { roundName: true, currency: true } },
            owner: { select: { user: { select: { firstName: true, lastName: true } } } },
          },
        });
        return rows.map((r) => ({
          type,
          id: r.id,
          title: r.startupInvestor.fullName,
          subtitle: r.round.roundName,
          stage: r.stage,
          isLead: r.isLead,
          // Deal visibility (pipeline:read) does not imply financial visibility.
          expectedAmount:
            resources.has("financial") && r.expectedAmount !== null ? Number(r.expectedAmount) : null,
          currency: r.round.currency,
          ownerName: r.owner?.user
            ? `${r.owner.user.firstName} ${r.owner.user.lastName}`.trim()
            : null,
        }));
      }
      case "task": {
        const rows = await prisma.task.findMany({
          where: { startupId, id: { in: ids } },
          select: { id: true, title: true, status: true, dueDate: true, priority: true },
        });
        return rows.map((r) => ({
          type,
          id: r.id,
          title: r.title,
          subtitle: null,
          status: r.status,
          dueDate: r.dueDate,
          priority: r.priority,
        }));
      }
      case "round": {
        const rows = await prisma.fundraisingRound.findMany({
          where: { startupId, id: { in: ids } },
          select: { id: true, roundName: true, status: true, targetAmount: true, currency: true },
        });
        return rows.map((r) => ({
          type,
          id: r.id,
          title: r.roundName,
          subtitle: null,
          status: r.status,
          targetAmount: r.targetAmount !== null ? Number(r.targetAmount) : null,
          currency: r.currency,
        }));
      }
      case "document": {
        const rows = await prisma.document.findMany({
          where: { startupId, id: { in: ids } },
          select: { id: true, title: true, documentType: true },
        });
        return rows.map((r) => ({
          type,
          id: r.id,
          title: r.title,
          subtitle: null,
          documentType: r.documentType,
        }));
      }
    }
  }

  /**
   * The backlink query: every message across the workspace's channels that
   * references this entity, newest first. This is what turns a chat mention
   * into part of the entity's permanent record rather than something you had
   * to be there to see — see DiscussionTab.tsx.
   */
  async getMentionsForTarget(
    startupId: string,
    memberId: string,
    roleId: string,
    targetType: MentionTargetType,
    targetId: string,
    limit: number,
  ) {
    const resources = await this.callerReadableResources(roleId);
    if (!this.mentionTypesFor(resources).has(targetType)) {
      throw createError("Insufficient permissions", 403, "FORBIDDEN");
    }

    const rows = await prisma.messageMention.findMany({
      where: {
        startupId,
        targetType,
        ...mentionTargetWhere(targetType, targetId),
        // Scoped to conversations the caller actually belongs to — a no-op
        // today since Phase 1 channels are workspace-wide, but load-bearing
        // once private channels exist.
        conversation: { members: { some: { memberId } } },
      },
      select: {
        id: true,
        createdAt: true,
        conversation: { select: { id: true, name: true } },
        message: { select: MESSAGE_SELECT },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return {
      data: rows.map((row) => ({
        mentionId: row.id,
        conversationId: row.conversation.id,
        conversationName: row.conversation.name,
        message: serializeMessage(row.message),
      })),
    };
  }

  private translateDuplicateName(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return createError("A channel with this name already exists", 409, "CONVERSATION_NAME_TAKEN");
    }
    return err;
  }
}

export const chatService = new ChatService();
