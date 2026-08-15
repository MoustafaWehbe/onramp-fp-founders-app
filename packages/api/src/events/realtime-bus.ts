/**
 * Fan-out for live events pushed to a signed-in user's open tabs.
 *
 * This is a generalization of what used to be notification-bus.ts: the same
 * per-user SSE channel now carries both notification and chat events, since
 * both are "tell this user's open tabs something changed" and multiplexing
 * keeps the app at one live connection per user instead of two.
 * notification-bus.ts re-exports this under its old name, so nothing that
 * already imports `notificationBus` needed to change.
 *
 * The implementation here is in-process: it only reaches clients connected to
 * *this* API process. That is correct for a single instance and wrong the
 * moment there are two an event raised on instance A never reaches a stream
 * held open by instance B. Swapping in Redis pub/sub means writing another
 * RealtimeBus and changing the export at the bottom of this file; nothing
 * that publishes or subscribes needs to know which one it got.
 */

export type NotificationEvent =
  | {
      type: "notification.created";
      notification: { id: string; type: string; title: string; body: string | null };
    }
  | { type: "notifications.changed" };

export type ChatEvent =
  | {
      type: "chat.message.created";
      conversationId: string;
      messageId: string;
      seq: string;
      /** Set when the message is a thread reply lets the client also refresh the open thread panel. */
      parentMessageId: string | null;
    }
  | { type: "chat.conversation.changed"; conversationId: string }
  | { type: "chat.message.reacted"; conversationId: string; messageId: string }
  | { type: "chat.typing"; conversationId: string; memberId: string; memberName: string };

export type RealtimeEvent = NotificationEvent | ChatEvent;

type Subscriber = (event: RealtimeEvent) => void;

export interface RealtimeBus {
  publish(userId: string, event: RealtimeEvent): void;
  /** Returns the unsubscribe function; callers must invoke it on disconnect. */
  subscribe(userId: string, subscriber: Subscriber): () => void;
  /** Open subscriptions, for health reporting and tests. */
  subscriberCount(userId?: string): number;
}

/**
 * A Map of Sets rather than Node's EventEmitter: every connected tab is one
 * more listener on the same key, and EventEmitter starts printing max-listener
 * warnings at eleven. There is nothing to warn about here.
 */
class InProcessRealtimeBus implements RealtimeBus {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  publish(userId: string, event: RealtimeEvent): void {
    const listeners = this.subscribers.get(userId);
    if (!listeners) return;

    // Copy first: a subscriber that unsubscribes while being notified would
    // otherwise mutate the set mid-iteration.
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (err) {
        // One broken stream must not stop the others from being told.
        console.error("[realtime-bus] subscriber threw:", err);
      }
    }
  }

  subscribe(userId: string, subscriber: Subscriber): () => void {
    let listeners = this.subscribers.get(userId);
    if (!listeners) {
      listeners = new Set();
      this.subscribers.set(userId, listeners);
    }
    listeners.add(subscriber);

    let released = false;
    return () => {
      // Guard against a double call the SSE handler unsubscribes on both
      // "close" and its own error path.
      if (released) return;
      released = true;

      listeners.delete(subscriber);
      // Drop the key entirely so an idle process does not accumulate one empty
      // Set per user who has ever connected.
      if (listeners.size === 0) this.subscribers.delete(userId);
    };
  }

  subscriberCount(userId?: string): number {
    if (userId) return this.subscribers.get(userId)?.size ?? 0;

    let total = 0;
    for (const listeners of this.subscribers.values()) total += listeners.size;
    return total;
  }
}

export const realtimeBus: RealtimeBus = new InProcessRealtimeBus();
