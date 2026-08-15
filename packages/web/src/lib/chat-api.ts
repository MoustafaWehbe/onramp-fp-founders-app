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

export type Conversation = {
  id: string;
  startupId: string;
  name: string;
  topic: string | null;
  lastMessageAt: string | null;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  startupId: string;
  conversationId: string;
  /** A decimal string — BigInt has no JSON representation. */
  seq: string;
  senderId: string | null;
  sender: MessageSender;
  body: string;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

export type CreateConversationInput = {
  name: string;
  topic?: string | null;
};

export type SendMessageInput = {
  body: string;
  /** Reused on retry so a resend never duplicates the message. */
  clientNonce: string;
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

export type MentionableItem = {
  type: MentionTargetType;
  id: string;
  label: string;
  sublabel: string | null;
};

/** One rendered reference chip's unfurl data — see chat.service.resolveOneType on the API. */
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
  conversationName: string;
  message: Message;
};

/** Empty or whitespace-only `q` returns no results — the caller decides when to fetch. */
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

/** The backlink query behind the Discussion tab — every message referencing one entity. */
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
