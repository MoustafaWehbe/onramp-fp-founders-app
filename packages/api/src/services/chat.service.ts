import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { realtimeBus } from "../events/realtime-bus";
import { notificationService } from "./notification.service";
import { storageService } from "./storage.service";
import { AUDIT_ACTIONS, recordAuditEvent } from "./audit-writer";
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
  NotifyLevelInput,
} from "../validators/chat.schemas";

const CONVERSATION_SELECT = {
  id: true,
  startupId: true,
  type: true,
  name: true,
  topic: true,
  lastMessageAt: true,
  archivedAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  // Every membership row, not just the caller's cheap for a workspace-sized
  // channel, and it is what lets a single query answer three different
  // per-viewer questions below: my own read state, my mute level, and (for a
  // DM) who the other person is.
  members: {
    select: {
      memberId: true,
      lastReadSeq: true,
      notifyLevel: true,
      member: {
        select: {
          id: true,
          user: { select: { firstName: true, lastName: true, avatarUrl: true, avatarStorageKey: true } },
        },
      },
    },
  },
} as const;

const MESSAGE_SELECT = {
  id: true,
  startupId: true,
  conversationId: true,
  seq: true,
  senderId: true,
  parentMessageId: true,
  replyCount: true,
  body: true,
  clientNonce: true,
  editedAt: true,
  deletedAt: true,
  createdAt: true,
  sender: {
    select: {
      id: true,
      user: {
        select: { id: true, firstName: true, lastName: true, avatarUrl: true, avatarStorageKey: true },
      },
    },
  },
  reactions: { select: { emoji: true, memberId: true } },
  attachments: {
    select: { document: { select: { id: true, title: true, documentType: true } } },
  },
} as const;

type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof CONVERSATION_SELECT }>;
type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

/** Collapses raw (emoji, memberId) reaction rows into per-emoji counts, tagged with whether the caller is among them. */
function summarizeReactions(rows: { emoji: string; memberId: string }[], callerMemberId: string) {
  const byEmoji = new Map<string, { count: number; reactedByMe: boolean }>();
  for (const row of rows) {
    const entry = byEmoji.get(row.emoji) ?? { count: 0, reactedByMe: false };
    entry.count += 1;
    if (row.memberId === callerMemberId) entry.reactedByMe = true;
    byEmoji.set(row.emoji, entry);
  }
  return [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, count: v.count, reactedByMe: v.reactedByMe }));
}

/**
 * A DM's display name is not stored it is the *other* participant, and
 * that is inherently per-viewer (A sees "B", B sees "A"), so it has to be
 * resolved here rather than baked into the row at write time.
 */
function counterpartOf(row: ConversationRow, callerMemberId: string) {
  const other = row.members.find((m) => m.memberId !== callerMemberId);
  if (!other) return null;
  return {
    memberId: other.memberId,
    firstName: other.member.user?.firstName ?? null,
    lastName: other.member.user?.lastName ?? null,
    avatarUrl: other.member.user
      ? storageService.resolveAvatarUrl(other.member.user.avatarStorageKey, other.member.user.avatarUrl)
      : null,
  };
}

function serializeConversation(row: ConversationRow, callerMemberId: string, unreadCount: number) {
  const own = row.members.find((m) => m.memberId === callerMemberId);
  return {
    id: row.id,
    startupId: row.startupId,
    type: row.type,
    name: row.name,
    topic: row.topic,
    lastMessageAt: row.lastMessageAt,
    archivedAt: row.archivedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    counterpart: row.type === "dm" ? counterpartOf(row, callerMemberId) : null,
    lastReadSeq: own?.lastReadSeq?.toString() ?? null,
    notifyLevel: own?.notifyLevel ?? "all",
    unreadCount,
  };
}

function serializeMessage(row: MessageRow, callerMemberId: string) {
  return {
    id: row.id,
    startupId: row.startupId,
    conversationId: row.conversationId,
    // BigInt has no JSON representation the wire format is a decimal
    // string, which listMessagesQuerySchema's `before` field reads back in.
    seq: row.seq.toString(),
    senderId: row.senderId,
    sender: row.sender
      ? {
          id: row.sender.id,
          firstName: row.sender.user?.firstName ?? null,
          lastName: row.sender.user?.lastName ?? null,
          avatarUrl: row.sender.user
            ? storageService.resolveAvatarUrl(row.sender.user.avatarStorageKey, row.sender.user.avatarUrl)
            : null,
        }
      : null,
    // A tombstoned message keeps its row (and its reply count, so a thread
    // isn't orphaned) but stops serving content once deletedAt is set — the
    // DB retains it for the audit trail, clients should not.
    body: row.deletedAt ? "" : row.body,
    parentMessageId: row.parentMessageId,
    replyCount: row.replyCount,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    reactions: row.deletedAt ? [] : summarizeReactions(row.reactions, callerMemberId),
    attachments: row.deletedAt
      ? []
      : row.attachments.map((a) => ({
          documentId: a.document.id,
          title: a.document.title,
          documentType: a.document.documentType,
        })),
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
   * membership (private channels, DMs) is additive later see the schema
   * comment above the Conversation model.
   */
  async createConversation(
    startupId: string,
    input: CreateConversationInput,
    actorUserId: string,
    actorMemberId: string,
  ) {
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
          // startupId is deliberately omitted here ConversationMember's
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

      return { data: serializeConversation(conversation, actorMemberId, 0) };
    } catch (err) {
      throw this.translateDuplicateName(err);
    }
  }

  /**
   * Finds or creates the 1:1 DM between the caller and another active
   * member. `dmKey` (the sorted member-id pair) is the dedup key a second
   * call from either side always lands back on the same conversation.
   */
  async startDirectMessage(startupId: string, actorMemberId: string, actorUserId: string, otherMemberId: string) {
    if (actorMemberId === otherMemberId) {
      throw createError("Cannot start a DM with yourself", 400, "INVALID_DM_TARGET");
    }

    const other = await prisma.startupMember.findFirst({
      where: { startupId, id: otherMemberId, status: "active" },
      select: { id: true },
    });
    if (!other) throw createError("Member not found", 404, "MEMBER_NOT_FOUND");

    const dmKey = [actorMemberId, otherMemberId].sort().join(":");

    const existing = await prisma.conversation.findUnique({
      where: { startupId_dmKey: { startupId, dmKey } },
      select: CONVERSATION_SELECT,
    });
    if (existing) return { data: serializeConversation(existing, actorMemberId, await this.unreadCountFor(existing, actorMemberId)) };

    try {
      const conversation = await prisma.conversation.create({
        data: {
          startupId,
          type: "dm",
          name: null,
          dmKey,
          createdBy: actorUserId,
          members: { create: [{ memberId: actorMemberId }, { memberId: otherMemberId }] },
        },
        select: CONVERSATION_SELECT,
      });
      return { data: serializeConversation(conversation, actorMemberId, 0) };
    } catch (err) {
      // Two tabs opening the same DM at once both lose the race to the
      // unique dmKey index the loser just reads back the winner's row
      // instead of surfacing an error for something that isn't one.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.conversation.findUniqueOrThrow({
          where: { startupId_dmKey: { startupId, dmKey } },
          select: CONVERSATION_SELECT,
        });
        return { data: serializeConversation(winner, actorMemberId, await this.unreadCountFor(winner, actorMemberId)) };
      }
      throw err;
    }
  }

  /** Channels and DMs the caller belongs to, most recently active first. */
  async listConversations(startupId: string, memberId: string) {
    const rows = await prisma.conversation.findMany({
      where: { startupId, archivedAt: null, members: { some: { memberId } } },
      select: CONVERSATION_SELECT,
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    });

    const unreadCounts = await Promise.all(rows.map((row) => this.unreadCountFor(row, memberId)));
    return { data: rows.map((row, i) => serializeConversation(row, memberId, unreadCounts[i])) };
  }

  /** Top-level messages from someone else, sent after the caller's own last-read point. */
  private async unreadCountFor(row: ConversationRow, memberId: string): Promise<number> {
    const own = row.members.find((m) => m.memberId === memberId);
    return prisma.message.count({
      where: {
        conversationId: row.id,
        parentMessageId: null,
        deletedAt: null,
        senderId: { not: memberId },
        ...(own?.lastReadSeq != null && { seq: { gt: own.lastReadSeq } }),
      },
    });
  }

  private async verifyMembership(
    startupId: string,
    conversationId: string,
    memberId: string,
  ): Promise<{ conversationName: string; conversationType: string }> {
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_memberId: { conversationId, memberId } },
      select: { id: true, conversation: { select: { startupId: true, name: true, type: true } } },
    });
    if (!membership || membership.conversation.startupId !== startupId) {
      throw createError("Conversation not found", 404, "CONVERSATION_NOT_FOUND");
    }
    // A DM has no stored name (see counterpartOf) the mention-notification
    // title falls back to type-based phrasing instead in notifyMentionedMembers.
    return {
      conversationName: membership.conversation.name ?? "",
      conversationType: membership.conversation.type,
    };
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
        // Thread replies live off GET .../messages/:messageId/replies —
        // the main list only ever shows top-level messages, with replyCount
        // as the hint that a thread exists.
        parentMessageId: null,
        deletedAt: null,
        ...(query.before && { seq: { lt: BigInt(query.before) } }),
      },
      select: MESSAGE_SELECT,
      orderBy: { seq: "desc" },
      take: query.limit,
    });

    // Fetched newest-first for the LIMIT to bite the right end of the room;
    // returned oldest-first, which is the order a message list renders in.
    return { data: rows.reverse().map((row) => serializeMessage(row, memberId)) };
  }

  /**
   * Full-text-ish search across every conversation the caller is a member of
   * including DMs they are actually in, never DMs about them. Scoped the
   * same way listConversations is (`members: { some: { memberId } }`), so a
   * caller can never see a conversation membership alone did not grant. Built
   * for the AI copilot's search_team_messages tool: capped and truncated so
   * one query cannot pull an unbounded amount of team chat into a prompt.
   */
  async searchMessages(startupId: string, memberId: string, query: string, limit = 30) {
    const rows = await prisma.message.findMany({
      where: {
        startupId,
        deletedAt: null,
        body: { contains: query, mode: "insensitive" },
        conversation: { members: { some: { memberId } }, archivedAt: null },
      },
      select: {
        id: true,
        conversationId: true,
        body: true,
        createdAt: true,
        conversation: { select: { type: true, name: true } },
        sender: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 30),
    });

    return {
      data: rows.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        conversationName: row.conversation.type === "dm" ? "Direct message" : row.conversation.name ?? "Unnamed channel",
        sender: this.senderDisplayName(row.sender?.user ?? null),
        excerpt: row.body.length > 400 ? `${row.body.slice(0, 400)}…` : row.body,
        createdAt: row.createdAt,
      })),
    };
  }

  /** Every reply to one top-level message, oldest first. */
  async listReplies(
    startupId: string,
    conversationId: string,
    memberId: string,
    parentMessageId: string,
    limit: number,
  ) {
    await this.verifyMembership(startupId, conversationId, memberId);

    const parent = await prisma.message.findFirst({
      where: { id: parentMessageId, conversationId, startupId },
      select: MESSAGE_SELECT,
    });
    if (!parent) throw createError("Message not found", 404, "MESSAGE_NOT_FOUND");

    const rows = await prisma.message.findMany({
      where: { parentMessageId, deletedAt: null },
      select: MESSAGE_SELECT,
      orderBy: { seq: "asc" },
      take: limit,
    });

    return {
      data: {
        parent: serializeMessage(parent, memberId),
        replies: rows.map((row) => serializeMessage(row, memberId)),
      },
    };
  }

  /**
   * Every member's userId, for live fan-out. Excludes members who are only a
   * pending invite (no linked user yet) there is no open tab to reach.
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
   * startup a stale reference (the target was deleted between the picker
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
    roleId: string,
    input: SendMessageInput,
  ) {
    const { conversationName, conversationType } = await this.verifyMembership(startupId, conversationId, memberId);

    // Retried POST with the same nonce resolves to the original row instead
    // of creating a duplicate the unique constraint is the source of truth,
    // this lookup just avoids a needless failed-insert round trip.
    const existing = await prisma.message.findUnique({
      where: { conversationId_clientNonce: { conversationId, clientNonce: input.clientNonce } },
      select: MESSAGE_SELECT,
    });
    if (existing) return { data: serializeMessage(existing, memberId) };

    // Threads are flat: replying to a reply re-parents onto the same
    // top-level message rather than nesting, matching Slack's model and
    // keeping "replies to message X" a single flat query.
    let parentMessageId: string | null = null;
    if (input.parentMessageId) {
      const parent = await prisma.message.findFirst({
        where: { id: input.parentMessageId, conversationId, startupId },
        select: { id: true, parentMessageId: true },
      });
      if (!parent) throw createError("Message not found", 404, "MESSAGE_NOT_FOUND");
      parentMessageId = parent.parentMessageId ?? parent.id;
    }

    const parsedMentions = parseMentions(input.body);
    const validMentions = await this.filterValidMentions(startupId, parsedMentions);

    // Attaching a vault document requires the same visibility a mention of
    // one would a caller who cannot read documents silently loses the
    // attachment rather than the whole send failing, same as an invalid
    // mention token.
    let validDocumentIds: string[] = [];
    if (input.documentIds && input.documentIds.length > 0) {
      const resources = await this.callerReadableResources(roleId);
      if (resources.has("documents")) {
        validDocumentIds = [...(await this.existingTargetIds("document", startupId, input.documentIds))];
      }
    }

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          startupId,
          conversationId,
          senderId: memberId,
          body: input.body,
          clientNonce: input.clientNonce,
          parentMessageId,
        },
        select: MESSAGE_SELECT,
      });

      await tx.conversation.update({
        where: { startupId_id: { startupId, id: conversationId } },
        data: { lastMessageAt: new Date() },
      });

      if (parentMessageId) {
        await tx.message.update({
          where: { id: parentMessageId },
          data: { replyCount: { increment: 1 } },
        });
      }

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

      if (validDocumentIds.length > 0) {
        await tx.messageAttachment.createMany({
          data: validDocumentIds.map((documentId) => ({ startupId, messageId: created.id, documentId })),
        });
      }

      // The sender has, by construction, seen everything up to their own
      // send advancing their own read pointer keeps them from seeing an
      // unread badge on the room they just posted in.
      await tx.conversationMember.update({
        where: { conversationId_memberId: { conversationId, memberId } },
        data: { lastReadSeq: created.seq, lastReadAt: new Date() },
      });

      return created;
    });

    // Re-read with the attachment/mention relations the create's `select`
    // couldn't see yet (they didn't exist until the createMany calls above).
    const withRelations =
      validMentions.length > 0 || validDocumentIds.length > 0
        ? ((await prisma.message.findUniqueOrThrow({ where: { id: message.id }, select: MESSAGE_SELECT })) as MessageRow)
        : message;

    const serialized = serializeMessage(withRelations, memberId);

    // Chat volume does not belong on the notification bell this is a live
    // signal for whoever already has the room open, not a persisted
    // Notification row.
    const recipientUserIds = await this.memberUserIds(conversationId, memberId);
    for (const userId of recipientUserIds) {
      realtimeBus.publish(userId, {
        type: "chat.message.created",
        conversationId,
        messageId: message.id,
        seq: serialized.seq,
        parentMessageId,
      });
    }

    // Being @-referenced is different from chat volume it's addressed to
    // someone specifically, so it does earn a real notification.
    const senderName = this.senderDisplayName(serialized.sender);
    const excerpt = toPlainExcerpt(input.body);
    const mentionedUserIds = await this.notifyMentionedMembers(startupId, conversationId, memberId, validMentions, {
      conversationName,
      conversationType,
      senderName,
      excerpt,
    });

    // A DM is addressed to one specific person too, even without a mention —
    // but only when they don't already have the room open, see notifyDmRecipient.
    await this.notifyDmRecipient(startupId, conversationId, conversationType, memberId, mentionedUserIds, {
      senderName,
      excerpt,
    });

    return { data: serialized };
  }

  private senderDisplayName(sender: { firstName: string | null; lastName: string | null } | null): string {
    if (!sender) return "Someone";
    const name = `${sender.firstName ?? ""} ${sender.lastName ?? ""}`.trim();
    return name || "A teammate";
  }

  /** Notifies every @-mentioned teammate and returns the set of userIds it notified, so a follow-up DM notification can avoid double-notifying the same person for the same message. */
  private async notifyMentionedMembers(
    startupId: string,
    conversationId: string,
    senderMemberId: string,
    mentions: ParsedMention[],
    context: {
      conversationName: string;
      conversationType: string;
      senderName: string;
      excerpt: string;
    },
  ): Promise<Set<string>> {
    const notified = new Set<string>();

    const memberMentionIds = mentions
      .filter((m) => m.type === "member" && m.id !== senderMemberId)
      .map((m) => m.id);
    if (memberMentionIds.length === 0) return notified;

    const members = await prisma.startupMember.findMany({
      where: { startupId, id: { in: memberMentionIds } },
      select: {
        userId: true,
        conversationMemberships: { where: { conversationId }, select: { notifyLevel: true } },
      },
    });

    for (const member of members) {
      if (!member.userId) continue;
      // Fully muting the room suppresses even a direct @-mention; "all" and
      // "mentions" both still let this through see ConversationMember.notifyLevel.
      if (member.conversationMemberships[0]?.notifyLevel === "none") continue;
      notified.add(member.userId);
      void notificationService.notifyMention({
        userId: member.userId,
        startupId,
        conversationId,
        senderName: context.senderName,
        conversationName: context.conversationType === "dm" ? null : context.conversationName,
        excerpt: context.excerpt,
      });
    }

    return notified;
  }

  /**
   * How stale `lastReadAt` must be before a plain DM message earns a
   * notification. This is a presence heuristic, not literal tab-focus
   * tracking: `MessageThread` marks the conversation read on open, and again
   * whenever a live message arrives while it's mounted (the SSE handler
   * invalidates the conversations query on every `chat.message.created`,
   * which re-triggers the read-on-open effect) so an open thread's
   * `lastReadAt` keeps refreshing on its own, while a closed one goes stale
   * within this window.
   */
  private static readonly ACTIVE_VIEW_WINDOW_MS = 60_000;

  /** A plain (non-mention) message in a DM notifies the other participant, unless they were already notified via a mention above, have this DM's notifications set to "mentions" or "none", or already have the room open. */
  private async notifyDmRecipient(
    startupId: string,
    conversationId: string,
    conversationType: string,
    senderMemberId: string,
    alreadyNotified: Set<string>,
    context: { senderName: string; excerpt: string },
  ): Promise<void> {
    if (conversationType !== "dm") return;

    const others = await prisma.conversationMember.findMany({
      where: { conversationId, memberId: { not: senderMemberId } },
      select: { notifyLevel: true, lastReadAt: true, member: { select: { userId: true } } },
    });

    const cutoff = new Date(Date.now() - ChatService.ACTIVE_VIEW_WINDOW_MS);

    for (const other of others) {
      const userId = other.member.userId;
      if (!userId) continue;
      if (alreadyNotified.has(userId)) continue;
      // "mentions" exists precisely to suppress this a plain message is
      // exactly what it's meant to hold back, while an explicit @-mention
      // still goes through notifyMentionedMembers above regardless.
      if (other.notifyLevel !== "all") continue;
      if (other.lastReadAt && other.lastReadAt > cutoff) continue;

      void notificationService.notifyDirectMessage({
        userId,
        startupId,
        conversationId,
        senderName: context.senderName,
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
   * caller cannot read, or that no longer exists, is simply omitted the
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
          select: {
            id: true,
            user: { select: { firstName: true, lastName: true, avatarUrl: true, avatarStorageKey: true } },
          },
        });
        return rows.map((r) => ({
          type,
          id: r.id,
          title: `${r.user?.firstName ?? ""} ${r.user?.lastName ?? ""}`.trim() || "Teammate",
          subtitle: null,
          avatarUrl: r.user
            ? storageService.resolveAvatarUrl(r.user.avatarStorageKey, r.user.avatarUrl)
            : null,
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
          select: { id: true, title: true, status: true, dueDate: true, priority: true, pipelineId: true },
        });
        return rows.map((r) => ({
          type,
          id: r.id,
          title: r.title,
          subtitle: null,
          status: r.status,
          dueDate: r.dueDate,
          priority: r.priority,
          pipelineId: r.pipelineId,
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
   * to be there to see see DiscussionTab.tsx.
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
        // Scoped to conversations the caller actually belongs to a no-op
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
        message: serializeMessage(row.message, memberId),
      })),
    };
  }

  /** Toggles one (message, member, emoji) reaction a second click removes it. Returns the message's fresh reaction summary. */
  async toggleReaction(startupId: string, messageId: string, memberId: string, emoji: string) {
    const message = await prisma.message.findFirst({
      where: { startupId, id: messageId },
      select: { id: true, conversationId: true },
    });
    if (!message) throw createError("Message not found", 404, "MESSAGE_NOT_FOUND");
    await this.verifyMembership(startupId, message.conversationId, memberId);

    const existing = await prisma.messageReaction.findUnique({
      where: { messageId_memberId_emoji: { messageId, memberId, emoji } },
    });
    if (existing) {
      await prisma.messageReaction.delete({ where: { id: existing.id } });
    } else {
      await prisma.messageReaction.create({ data: { startupId, messageId, memberId, emoji } });
    }

    const rows = await prisma.messageReaction.findMany({
      where: { messageId },
      select: { emoji: true, memberId: true },
    });
    const reactions = summarizeReactions(rows, memberId);

    const recipientUserIds = await this.memberUserIds(message.conversationId, memberId);
    for (const userId of recipientUserIds) {
      realtimeBus.publish(userId, {
        type: "chat.message.reacted",
        conversationId: message.conversationId,
        messageId,
      });
    }

    return { data: { messageId, reactions } };
  }

  /**
   * Soft-delete (tombstone): deletedAt is set, the row itself never goes
   * away, and serializeMessage blanks the body/reactions/attachments so a
   * deleted message stops being served to other clients even though the DB
   * keeps it. Self-serve only — you can retract your own message, never
   * someone else's, regardless of role.
   */
  async deleteMessage(startupId: string, messageId: string, memberId: string, userId: string) {
    const message = await prisma.message.findFirst({
      where: { startupId, id: messageId },
      select: { id: true, conversationId: true, senderId: true, deletedAt: true, parentMessageId: true },
    });
    if (!message) throw createError("Message not found", 404, "MESSAGE_NOT_FOUND");
    if (message.deletedAt) {
      throw createError("This message was already deleted", 409, "MESSAGE_ALREADY_DELETED");
    }

    await this.verifyMembership(startupId, message.conversationId, memberId);

    if (message.senderId !== memberId) {
      throw createError("You can only delete your own messages", 403, "FORBIDDEN");
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
      select: MESSAGE_SELECT,
    });

    await recordAuditEvent({
      startupId,
      userId,
      action: AUDIT_ACTIONS.DELETE,
      entityType: "message",
      entityId: messageId,
      changes: { conversationId: message.conversationId },
    });

    const recipientUserIds = await this.memberUserIds(message.conversationId, memberId);
    for (const recipientUserId of recipientUserIds) {
      realtimeBus.publish(recipientUserId, {
        type: "chat.message.deleted",
        conversationId: message.conversationId,
        messageId,
        parentMessageId: message.parentMessageId,
      });
    }

    return { data: serializeMessage(updated, memberId) };
  }

  /** Advances the caller's read pointer to the latest top-level message clears the unread badge. */
  async markRead(startupId: string, conversationId: string, memberId: string) {
    await this.verifyMembership(startupId, conversationId, memberId);

    const latest = await prisma.message.findFirst({
      where: { conversationId, parentMessageId: null, deletedAt: null },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    if (!latest) return { data: { lastReadSeq: null } };

    // Only ever moves forward a concurrent read from another tab that
    // already caught up further (or the caller's own send, which advances
    // this same pointer) must not be walked backward by a slow one.
    await prisma.conversationMember.updateMany({
      where: {
        conversationId,
        memberId,
        OR: [{ lastReadSeq: null }, { lastReadSeq: { lt: latest.seq } }],
      },
      data: { lastReadSeq: latest.seq, lastReadAt: new Date() },
    });

    // Read back rather than trusting `latest.seq` the guard above may have
    // been a no-op, and reporting a seq lower than what is actually stored
    // would be a lie the caller has no way to detect.
    const own = await prisma.conversationMember.findUnique({
      where: { conversationId_memberId: { conversationId, memberId } },
      select: { lastReadSeq: true },
    });

    return { data: { lastReadSeq: own?.lastReadSeq?.toString() ?? null } };
  }

  /** "all" | "mentions" | "none" see ConversationMember.notifyLevel for what each currently changes. */
  async setNotifyLevel(startupId: string, conversationId: string, memberId: string, level: NotifyLevelInput["level"]) {
    await this.verifyMembership(startupId, conversationId, memberId);

    await prisma.conversationMember.update({
      where: { conversationId_memberId: { conversationId, memberId } },
      data: { notifyLevel: level },
    });

    return { data: { notifyLevel: level } };
  }

  /**
   * Channels are workspace-wide (every active member is added at creation —
   * see createConversation), so archiving one is a moderation call on a
   * shared room, not something every member can do to it hence gated by
   * chat:manage at the route rather than mere membership. DMs can't be
   * archived: there is no shared room to moderate, only two people's own.
   */
  async setConversationArchived(
    startupId: string,
    conversationId: string,
    archived: boolean,
    actorMemberId: string,
    actorUserId: string,
  ) {
    const conversation = await prisma.conversation.findUnique({
      where: { startupId_id: { startupId, id: conversationId } },
      select: { id: true, type: true, name: true, archivedAt: true },
    });
    if (!conversation) throw createError("Conversation not found", 404, "CONVERSATION_NOT_FOUND");
    if (conversation.type !== "channel") {
      throw createError("Only channels can be archived", 400, "CANNOT_ARCHIVE_DM");
    }

    if (archived === (conversation.archivedAt !== null)) {
      return { data: { id: conversationId, archivedAt: conversation.archivedAt } };
    }

    const nextArchivedAt = archived ? new Date() : null;
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { archivedAt: nextArchivedAt },
    });

    await recordAuditEvent({
      startupId,
      userId: actorUserId,
      action: archived ? AUDIT_ACTIONS.ARCHIVE : AUDIT_ACTIONS.UPDATE,
      entityType: "conversation",
      entityId: conversationId,
      changes: { name: conversation.name, archived },
    });

    const recipientUserIds = await this.memberUserIds(conversationId, actorMemberId);
    for (const recipientUserId of recipientUserIds) {
      realtimeBus.publish(recipientUserId, { type: "chat.conversation.changed", conversationId });
    }

    return { data: { id: conversationId, archivedAt: nextArchivedAt } };
  }

  /**
   * Fire-and-forget: no DB row, just an SSE ping to the other open tabs in
   * this room. The client debounces calls and lets the "X is typing…" line
   * expire client-side a few seconds after the last ping there is nothing
   * here for a server-side timeout to clean up.
   */
  async notifyTyping(startupId: string, conversationId: string, memberId: string): Promise<void> {
    await this.verifyMembership(startupId, conversationId, memberId);

    const member = await prisma.startupMember.findUnique({
      where: { id: memberId },
      select: { user: { select: { firstName: true, lastName: true } } },
    });
    const memberName = this.senderDisplayName(member?.user ?? null);

    const recipientUserIds = await this.memberUserIds(conversationId, memberId);
    for (const userId of recipientUserIds) {
      realtimeBus.publish(userId, { type: "chat.typing", conversationId, memberId, memberName });
    }
  }

  private translateDuplicateName(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return createError("A channel with this name already exists", 409, "CONVERSATION_NAME_TAKEN");
    }
    return err;
  }
}

export const chatService = new ChatService();
