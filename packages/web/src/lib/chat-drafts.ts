import type { MentionableItem } from "./chat-api";
import type { ComposerMention } from "./mentions";

export type ChatDraft = {
  body: string;
  pendingMentions: ComposerMention[];
  attachedDocs: MentionableItem[];
  clientNonce: string;
};

function storageKey(startupId: string, conversationId: string, parentMessageId?: string): string {
  return `raise:chat-draft:${startupId}:${conversationId}:${parentMessageId ?? "top"}`;
}

/**
 * Drafts stay in this browser tab rather than durable local storage. That
 * survives room switches and an accidental refresh without leaving sensitive
 * fundraising conversations behind indefinitely on a shared computer.
 */
export function readChatDraft(
  startupId: string,
  conversationId: string,
  parentMessageId?: string,
): ChatDraft | null {
  try {
    const raw = sessionStorage.getItem(storageKey(startupId, conversationId, parentMessageId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<ChatDraft>;
    if (typeof draft.body !== "string" || typeof draft.clientNonce !== "string") return null;
    return {
      body: draft.body,
      clientNonce: draft.clientNonce,
      pendingMentions: Array.isArray(draft.pendingMentions) ? draft.pendingMentions : [],
      attachedDocs: Array.isArray(draft.attachedDocs) ? draft.attachedDocs : [],
    };
  } catch {
    return null;
  }
}

export function writeChatDraft(
  startupId: string,
  conversationId: string,
  parentMessageId: string | undefined,
  draft: ChatDraft,
): void {
  const key = storageKey(startupId, conversationId, parentMessageId);
  try {
    if (!draft.body.trim() && draft.attachedDocs.length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage can be disabled or full. The in-memory composer still works.
  }
}
