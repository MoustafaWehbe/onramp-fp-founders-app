import { apiClient } from "./api-client";
import type { MentionTargetType } from "./mentions";
import type { PipelineStageId } from "./mock-data";
import type { Priority } from "./task-api";

export type MessageSender = {
  /** A StartupMember id. */
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
} | null;

export type ConversationCounterpart = {
  /** A StartupMember id. */
  memberId: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
} | null;

export type NotifyLevel = "all" | "mentions" | "none";

export type Conversation = {
  id: string;
  startupId: string;
  type: "channel" | "dm";
  /** Null for a DM see `counterpart`. */
  name: string | null;
  topic: string | null;
  /** Set only when type is "dm" the other participant, resolved for the calling viewer. */
  counterpart: ConversationCounterpart;
  /** The caller's own read pointer a decimal string, same encoding as Message.seq. */
  lastReadSeq: string | null;
  /** The caller's own mute level for this conversation. */
  notifyLevel: NotifyLevel;
  unreadCount: number;
  lastMessageAt: string | null;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

export type MessageAttachment = {
  documentId: string;
  title: string;
  documentType: string;
};

export type Message = {
  id: string;
  startupId: string;
  conversationId: string;
  /** A decimal string BigInt has no JSON representation. */
  seq: string;
  senderId: string | null;
  sender: MessageSender;
  body: string;
  /** Set for a thread reply always the top-level ancestor's id, since threads are flat. */
  parentMessageId: string | null;
  replyCount: number;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  reactions: MessageReactionSummary[];
  attachments: MessageAttachment[];
};

export type ReplyThread = {
  parent: Message;
  replies: Message[];
};

export type CreateConversationInput = {
  name: string;
  topic?: string | null;
};

export type SendMessageInput = {
  body: string;
  /** Reused on retry so a resend never duplicates the message. */
  clientNonce: string;
  /** Reply in a thread must name a message already in this conversation. */
  parentMessageId?: string;
  /** Vault documents to attach, beyond anything referenced inline with @doc. */
  documentIds?: string[];
};

export async function listConversations(startupId: string) {
  const { data } = await apiClient.get<{ data: Conversation[] }>(
    `/startups/${startupId}/chat/conversations`,
  );
  return data.data;
}

export async function createConversation(startupId: string, input: CreateConversationInput) {
  const { data } = await apiClient.post<{ data: Conversation }>(
    `/startups/${startupId}/chat/conversations`,
    input,
  );
  return data.data;
}

/** Finds or creates the 1:1 DM with another active member. */
export async function startDirectMessage(startupId: string, memberId: string) {
  const { data } = await apiClient.post<{ data: Conversation }>(`/startups/${startupId}/chat/dm`, {
    memberId,
  });
  return data.data;
}

export async function listMessages(
  startupId: string,
  conversationId: string,
  params: { before?: string; limit?: number } = {},
) {
  const { data } = await apiClient.get<{ data: Message[] }>(
    `/startups/${startupId}/chat/conversations/${conversationId}/messages`,
    { params },
  );
  return data.data;
}

export async function sendMessage(
  startupId: string,
  conversationId: string,
  input: SendMessageInput,
) {
  const { data } = await apiClient.post<{ data: Message }>(
    `/startups/${startupId}/chat/conversations/${conversationId}/messages`,
    input,
  );
  return data.data;
}

/** Every reply to one top-level message, oldest first, plus the parent itself. */
export async function listReplies(
  startupId: string,
  conversationId: string,
  messageId: string,
  limit = 100,
) {
  const { data } = await apiClient.get<{ data: ReplyThread }>(
    `/startups/${startupId}/chat/conversations/${conversationId}/messages/${messageId}/replies`,
    { params: { limit } },
  );
  return data.data;
}

/** Toggle semantics reacting with the same emoji a second time removes it. */
export async function toggleReaction(startupId: string, messageId: string, emoji: string) {
  const { data } = await apiClient.post<{ data: { messageId: string; reactions: MessageReactionSummary[] } }>(
    `/startups/${startupId}/chat/messages/${messageId}/reactions`,
    { emoji },
  );
  return data.data;
}

/**
 * Soft-delete (tombstone) never a hard delete, but the response and every
 * other client's view have body/reactions/attachments blanked. Self-serve
 * only: retracts the caller's own message. No moderator override.
 */
export async function deleteMessage(startupId: string, messageId: string) {
  const { data } = await apiClient.delete<{ data: Message }>(
    `/startups/${startupId}/chat/messages/${messageId}`,
  );
  return data.data;
}

/** Channels only chat:manage moderation action; rejects DMs (400 CANNOT_ARCHIVE_DM). */
export async function setConversationArchived(startupId: string, conversationId: string, archived: boolean) {
  const { data } = await apiClient.patch<{ data: { id: string; archivedAt: string | null } }>(
    `/startups/${startupId}/chat/conversations/${conversationId}/archived`,
    { archived },
  );
  return data.data;
}

/** Advances the caller's read pointer to the latest message clears the unread badge. */
export async function markConversationRead(startupId: string, conversationId: string) {
  const { data } = await apiClient.post<{ data: { lastReadSeq: string | null } }>(
    `/startups/${startupId}/chat/conversations/${conversationId}/read`,
  );
  return data.data;
}

export async function setNotifyLevel(startupId: string, conversationId: string, level: NotifyLevel) {
  const { data } = await apiClient.patch<{ data: { notifyLevel: NotifyLevel } }>(
    `/startups/${startupId}/chat/conversations/${conversationId}/notify-level`,
    { level },
  );
  return data.data;
}

/** Fire-and-forget presence ping no response payload to wait on. */
export async function pingTyping(startupId: string, conversationId: string) {
  await apiClient.post(`/startups/${startupId}/chat/conversations/${conversationId}/typing`);
}

export type MentionableItem = {
  type: MentionTargetType;
  id: string;
  label: string;
  sublabel: string | null;
};

/** One rendered reference chip's unfurl data see chat.service.resolveOneType on the API. */
export type ResolvedMention =
  | { type: "member"; id: string; title: string; subtitle: null; avatarUrl: string | null }
  | {
      type: "investor";
      id: string;
      title: string;
      subtitle: string | null;
      investorType: string | null;
    }
  | {
      type: "deal";
      id: string;
      title: string;
      subtitle: string;
      stage: PipelineStageId;
      isLead: boolean;
      /** Null without financial:read, even though the deal itself is visible with pipeline:read alone. */
      expectedAmount: number | null;
      currency: string;
      ownerName: string | null;
    }
  | {
      type: "task";
      id: string;
      title: string;
      subtitle: null;
      status: string;
      dueDate: string | null;
      priority: Priority;
      /** The deal this task belongs to used to deep-link the unfurl card into the right Pipeline dialog. */
      pipelineId: string;
    }
  | {
      type: "round";
      id: string;
      title: string;
      subtitle: null;
      status: string;
      targetAmount: number | null;
      currency: string;
    }
  | { type: "document"; id: string; title: string; subtitle: null; documentType: string };

export type MentionBacklinkEntry = {
  mentionId: string;
  conversationId: string;
  /** Null when the source conversation is a DM. */
  conversationName: string | null;
  message: Message;
};

/** Empty or whitespace-only `q` returns no results the caller decides when to fetch. */
export async function searchMentionables(
  startupId: string,
  params: { q: string; types?: MentionTargetType[] },
) {
  const { data } = await apiClient.get<{ data: MentionableItem[] }>(
    `/startups/${startupId}/chat/mentionables`,
    { params: { q: params.q, types: params.types?.join(",") } },
  );
  return data.data;
}

/** Best-effort: an id the caller can't read, or that no longer exists, is simply absent from the result. */
export async function resolveMentions(
  startupId: string,
  items: { type: MentionTargetType; id: string }[],
) {
  if (items.length === 0) return [];
  const { data } = await apiClient.post<{ data: ResolvedMention[] }>(
    `/startups/${startupId}/chat/resolve`,
    { items },
  );
  return data.data;
}

/** The backlink query behind the Discussion tab every message referencing one entity. */
export async function listMentionsForTarget(
  startupId: string,
  targetType: MentionTargetType,
  targetId: string,
  limit = 20,
) {
  const { data } = await apiClient.get<{ data: MentionBacklinkEntry[] }>(
    `/startups/${startupId}/chat/mentions`,
    { params: { targetType, targetId, limit } },
  );
  return data.data;
}
