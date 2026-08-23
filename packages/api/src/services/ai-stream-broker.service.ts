import { randomUUID } from "crypto";
import type IORedis from "ioredis";
import { createRedis, getRedis } from "../db/redis";
import { logger } from "../utils/logger";

export interface AiStreamEnvelope {
  version: 1;
  sessionId: string;
  messageId: string;
  sequence: number;
  timestamp: string;
  type: "stream.ready" | "stream.closed" | "message.started" | "message.delta" | "citation.added" | "artifact.ready" | "artifact.failed" | "message.snapshot" | "tool.started" | "tool.completed" | "message.completed" | "message.failed" | "message.cancelled";
  payload: Record<string, unknown>;
}

type StreamState = { sequence: number; events: AiStreamEnvelope[]; subscribers: Set<(event: AiStreamEnvelope) => void>; };

/**
 * The local buffer delivers live events without a network hop. A bounded Redis
 * copy makes reconnect replay survive a request landing on another API process.
 * Redis failures never prevent a terminal message state from being persisted.
 */
export class AiStreamBroker {
  private readonly streams = new Map<string, StreamState>();
  private readonly origin = randomUUID();
  private subscriber: IORedis | null = null;
  private subscriberReady: Promise<void> | null = null;

  publish(sessionId: string, messageId: string, type: AiStreamEnvelope["type"], payload: Record<string, unknown>): AiStreamEnvelope {
    const state = this.streams.get(messageId) ?? { sequence: 0, events: [], subscribers: new Set() };
    this.streams.set(messageId, state);
    const event: AiStreamEnvelope = { version: 1, sessionId, messageId, sequence: ++state.sequence, timestamp: new Date().toISOString(), type, payload };
    state.events.push(event);
    if (state.events.length > 500) state.events.shift();
    this.persistReplayAndFanOut(messageId, event);
    for (const subscriber of [...state.subscribers]) subscriber(event);
    if (["message.completed", "message.failed", "message.cancelled"].includes(type)) this.scheduleCleanup(messageId, state);
    return event;
  }

  replay(messageId: string, afterSequence = 0): AiStreamEnvelope[] {
    return (this.streams.get(messageId)?.events ?? []).filter((event) => event.sequence > afterSequence);
  }

  async replayPersistent(messageId: string, afterSequence = 0): Promise<AiStreamEnvelope[]> {
    const local = this.replay(messageId, afterSequence);
    if (local.length || process.env.NODE_ENV === "test") return local;
    try {
      const raw = await getRedis().lrange(this.key(messageId), 0, 499);
      return raw
        .map((item) => JSON.parse(item) as AiStreamEnvelope)
        .filter((event) => event.sequence > afterSequence)
        .sort((a, b) => a.sequence - b.sequence);
    } catch {
      return [];
    }
  }

  subscribe(messageId: string, subscriber: (event: AiStreamEnvelope) => void): () => void {
    const state = this.streams.get(messageId) ?? { sequence: 0, events: [], subscribers: new Set() };
    this.streams.set(messageId, state);
    state.subscribers.add(subscriber);
    this.ensureSubscriber();
    return () => {
      state.subscribers.delete(subscriber);
      if (state.subscribers.size === 0) this.scheduleCleanup(messageId, state);
    };
  }

  /** Resolves once this process can receive live events published by another replica. */
  async readyForRemoteEvents(): Promise<void> {
    this.ensureSubscriber();
    await this.subscriberReady;
  }

  private persistReplayAndFanOut(messageId: string, event: AiStreamEnvelope): void {
    if (process.env.NODE_ENV === "test") return;
    const redis = getRedis();
    const key = this.key(messageId);
    const livePayload = JSON.stringify({ origin: this.origin, event });
    void redis.multi()
      .rpush(key, JSON.stringify(event))
      .ltrim(key, -500, -1)
      .expire(key, 300)
      // Persist and publish in one ordered Redis transaction. A reconnecting
      // replica can therefore recover the event even if it subscribes just
      // after this publish lands.
      .publish(this.channel(messageId), livePayload)
      .exec()
      .catch(() => {
      // The local buffer still covers this process when Redis is unavailable.
    });
  }

  private ensureSubscriber(): void {
    if (process.env.NODE_ENV === "test" || this.subscriber) return;
    const sub = createRedis();
    sub.on("pmessage", (_pattern, channel: string, raw: string) => {
      if (!channel.startsWith("ai:stream-live:")) return;
      try {
        const parsed = JSON.parse(raw) as { origin?: string; event?: AiStreamEnvelope };
        if (parsed.origin === this.origin || !parsed.event) return;
        const event = parsed.event;
        if (channel !== this.channel(event.messageId)) return;
        const state = this.streams.get(event.messageId);
        if (!state) return;
        // Keep the remote copy locally replayable for this connection and any
        // same-process reconnect, without publishing it back into Redis.
        if (!state.events.some((existing) => existing.sequence === event.sequence)) {
          state.events.push(event);
          state.events.sort((a, b) => a.sequence - b.sequence);
          if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
          state.sequence = Math.max(state.sequence, event.sequence);
        }
        for (const listener of [...state.subscribers]) listener(event);
        if (["message.completed", "message.failed", "message.cancelled"].includes(event.type)) this.scheduleCleanup(event.messageId, state);
      } catch (err) {
        logger.error({ err }, "[ai-stream-broker] ignored malformed live event");
      }
    });
    sub.on("error", (err) => logger.error({ err }, "[ai-stream-broker] redis subscriber error"));
    this.subscriber = sub;
    this.subscriberReady = sub.psubscribe("ai:stream-live:*")
      .then(() => undefined)
      .catch((err) => {
        logger.error({ err }, "[ai-stream-broker] failed to subscribe to live events");
      });
  }

  private scheduleCleanup(messageId: string, state: StreamState): void {
    const cleanup = setTimeout(() => {
      if (this.streams.get(messageId) === state && state.subscribers.size === 0) this.streams.delete(messageId);
    }, 5 * 60_000);
    cleanup.unref();
  }

  private key(messageId: string): string { return `ai:stream-replay:${messageId}`; }
  private channel(messageId: string): string { return `ai:stream-live:${messageId}`; }
}

export const aiStreamBroker = new AiStreamBroker();
