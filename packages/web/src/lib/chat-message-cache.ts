import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Message, ReplyThread, SendMessageInput } from "./chat-api";
import { qk } from "./query-keys";

type MessageHistory = InfiniteData<Message[], string | undefined>;

export function retryInputForMessage(message: Message): SendMessageInput | null {
  if (!message.clientNonce) return null;
  return {
    body: message.body,
    clientNonce: message.clientNonce,
    parentMessageId: message.parentMessageId ?? undefined,
    documentIds:
      message.attachments.length > 0
        ? message.attachments.map((attachment) => attachment.documentId)
        : undefined,
  };
}

function withoutSubmission(messages: Message[], submission: Message): Message[] {
  return messages.filter(
    (message) =>
      message.id !== submission.id &&
      (!submission.clientNonce || message.clientNonce !== submission.clientNonce),
  );
}

export function insertOptimisticMessage(
  queryClient: QueryClient,
  startupId: string,
  message: Message,
): void {
  if (message.parentMessageId) {
    queryClient.setQueryData<ReplyThread>(qk.replies(startupId, message.parentMessageId), (current) =>
      current ? { ...current, replies: [...withoutSubmission(current.replies, message), message] } : current,
    );
    return;
  }

  queryClient.setQueryData<MessageHistory>(
    qk.messages(startupId, message.conversationId),
    (current) => {
      if (!current) return { pages: [[message]], pageParams: [undefined] };
      const pages = current.pages.map((page) => withoutSubmission(page, message));
      pages[0] = [...(pages[0] ?? []), message];
      return { ...current, pages };
    },
  );
}

export function replaceOptimisticMessage(
  queryClient: QueryClient,
  startupId: string,
  optimistic: Message,
  delivered: Message,
): void {
  if (optimistic.parentMessageId) {
    queryClient.setQueryData<ReplyThread>(qk.replies(startupId, optimistic.parentMessageId), (current) =>
      current
        ? {
            ...current,
            replies: [...withoutSubmission(withoutSubmission(current.replies, optimistic), delivered), delivered],
          }
        : current,
    );
    return;
  }

  queryClient.setQueryData<MessageHistory>(
    qk.messages(startupId, optimistic.conversationId),
    (current) => {
      if (!current) return { pages: [[delivered]], pageParams: [undefined] };
      const pages = current.pages.map((page) =>
        withoutSubmission(withoutSubmission(page, optimistic), delivered),
      );
      pages[0] = [...(pages[0] ?? []), delivered];
      return { ...current, pages };
    },
  );
}

export function setOptimisticDeliveryState(
  queryClient: QueryClient,
  startupId: string,
  message: Message,
  deliveryState: "sending" | "failed",
): void {
  const update = (candidate: Message) =>
    candidate.id === message.id ? { ...candidate, deliveryState } : candidate;

  if (message.parentMessageId) {
    queryClient.setQueryData<ReplyThread>(qk.replies(startupId, message.parentMessageId), (current) =>
      current ? { ...current, replies: current.replies.map(update) } : current,
    );
    return;
  }

  queryClient.setQueryData<MessageHistory>(qk.messages(startupId, message.conversationId), (current) =>
    current ? { ...current, pages: current.pages.map((page) => page.map(update)) } : current,
  );
}
