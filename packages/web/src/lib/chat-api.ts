import { apiClient } from "./api-client";

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
