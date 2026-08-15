/**
 * A typing ping never touches React Query — there is no cache entry that
 * makes sense for something that expires itself a few seconds after arrival.
 * This is a tiny module-level pub/sub instead: useNotificationStream
 * publishes into it on a `chat.typing` SSE event, and useTypingUsers
 * subscribes, scoped to whichever conversation is open.
 */

export type TypingEvent = {
  conversationId: string;
  memberId: string;
  memberName: string;
};

type Listener = (event: TypingEvent) => void;

const listeners = new Set<Listener>();

export function publishTyping(event: TypingEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeTyping(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
