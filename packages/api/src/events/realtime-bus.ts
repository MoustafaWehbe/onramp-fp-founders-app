/**
 * Fan-out for live events pushed to a signed-in user's open tabs.
 *
 * This is a generalization of what used to be notification-bus.ts: the same
 * per-user SSE channel carries both notification and chat events, since both
 * are "tell this user's open tabs something changed" and multiplexing keeps
 * the app at one live connection per user instead of two.
 * notification-bus.ts re-exports this under its old name, so nothing that
 * already imports `notificationBus` needed to change.
 *
 * Transport to the browser is still Server-Sent Events
 * (notificationController.stream). Redis pub/sub is the *bus between
 * processes*: cron, workers, and any extra API replica publish here, and every
 * process that holds an open SSE for that user receives the message and writes
 * it onto its local streams. An in-process Map alone is correct for one API
 * instance and wrong the moment there are two.
 *
 * Tests and REALTIME_BUS=memory keep the in-process implementation so unit
 * tests do not need Redis.
 */

import { createRedis, getRedis } from "../db/redis";
import type IORedis from "ioredis";

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
  | {
      type: "chat.message.deleted";
      conversationId: string;
      messageId: string;
      /** Set when the deleted message was a thread reply, so the client also refreshes the open thread panel. */
      parentMessageId: string | null;
    }
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

const CHANNEL_PREFIX = "realtime:user:";

function channelFor(userId: string): string {
  return `${CHANNEL_PREFIX}${userId}`;
}

function dispatchLocal(
  listeners: Set<Subscriber> | undefined,
  event: RealtimeEvent,
): void {
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

/**
 * A Map of Sets rather than Node's EventEmitter: every connected tab is one
 * more listener on the same key, and EventEmitter starts printing max-listener
 * warnings at eleven. There is nothing to warn about here.
 */
export class InProcessRealtimeBus implements RealtimeBus {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  publish(userId: string, event: RealtimeEvent): void {
    dispatchLocal(this.subscribers.get(userId), event);
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

/**
 * Publishes every event through Redis so any API process (or future worker)
 * that holds SSE tabs for that user can deliver them. Local tab fan-out is
 * unchanged: Redis → this process → every open EventSource for that userId.
 */
export class RedisRealtimeBus implements RealtimeBus {
  private readonly local = new Map<string, Set<Subscriber>>();
  private readonly publisher = getRedis();
  private subscriber: IORedis | null = null;

  private ensureSubscriber(): IORedis {
    if (this.subscriber) return this.subscriber;

    // A connection in subscribe mode can only run pub/sub commands, so this
    // must be a dedicated socket never the shared getRedis() used by BullMQ.
    const sub = createRedis();
    sub.on("message", (channel, raw) => {
      if (!channel.startsWith(CHANNEL_PREFIX)) return;
      const userId = channel.slice(CHANNEL_PREFIX.length);
      let event: RealtimeEvent;
      try {
        event = JSON.parse(raw) as RealtimeEvent;
      } catch (err) {
        console.error("[realtime-bus] ignored malformed redis payload:", err);
        return;
      }
      dispatchLocal(this.local.get(userId), event);
    });
    sub.on("error", (err) => {
      console.error("[realtime-bus] redis subscriber error:", err);
    });

    this.subscriber = sub;
    return sub;
  }

  publish(userId: string, event: RealtimeEvent): void {
    void this.publisher.publish(channelFor(userId), JSON.stringify(event)).catch((err) => {
      console.error("[realtime-bus] redis publish failed:", err);
    });
  }

  subscribe(userId: string, subscriber: Subscriber): () => void {
    let listeners = this.local.get(userId);
    const firstForUser = !listeners;
    if (!listeners) {
      listeners = new Set();
      this.local.set(userId, listeners);
    }
    listeners.add(subscriber);

    if (firstForUser) {
      const channel = channelFor(userId);
      void this.ensureSubscriber()
        .subscribe(channel)
        .catch((err) => {
          console.error(`[realtime-bus] failed to subscribe ${channel}:`, err);
        });
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;

      listeners.delete(subscriber);
      if (listeners.size > 0) return;

      this.local.delete(userId);
      const channel = channelFor(userId);
      if (this.subscriber) {
        void this.subscriber.unsubscribe(channel).catch((err) => {
          console.error(`[realtime-bus] failed to unsubscribe ${channel}:`, err);
        });
      }
    };
  }

  subscriberCount(userId?: string): number {
    if (userId) return this.local.get(userId)?.size ?? 0;

    let total = 0;
    for (const listeners of this.local.values()) total += listeners.size;
    return total;
  }
}

function createRealtimeBus(): RealtimeBus {
  // Unit tests assert sync in-process delivery; Redis would make those async
  // and require a live server. REALTIME_BUS=memory is an escape hatch for local
  // debugging without Redis pub/sub.
  if (process.env.NODE_ENV === "test" || process.env.REALTIME_BUS === "memory") {
    return new InProcessRealtimeBus();
  }
  return new RedisRealtimeBus();
}

export const realtimeBus: RealtimeBus = createRealtimeBus();
