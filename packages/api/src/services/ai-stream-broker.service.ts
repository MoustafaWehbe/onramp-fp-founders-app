import { getRedis } from "../db/redis";

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

  publish(sessionId: string, messageId: string, type: AiStreamEnvelope["type"], payload: Record<string, unknown>): AiStreamEnvelope {
    const state = this.streams.get(messageId) ?? { sequence: 0, events: [], subscribers: new Set() };
    this.streams.set(messageId, state);
    const event: AiStreamEnvelope = { version: 1, sessionId, messageId, sequence: ++state.sequence, timestamp: new Date().toISOString(), type, payload };
    state.events.push(event);
    if (state.events.length > 500) state.events.shift();
    this.persistReplay(messageId, event);
    for (const subscriber of [...state.subscribers]) subscriber(event);
    if (["message.completed", "message.failed", "message.cancelled"].includes(type)) {
      const cleanup = setTimeout(() => {
        if (this.streams.get(messageId) === state && state.subscribers.size === 0) this.streams.delete(messageId);
      }, 5 * 60_000);
      cleanup.unref();
    }
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
    return () => state.subscribers.delete(subscriber);
  }

  private persistReplay(messageId: string, event: AiStreamEnvelope): void {
    if (process.env.NODE_ENV === "test") return;
    const redis = getRedis();
    const key = this.key(messageId);
    void redis.multi().rpush(key, JSON.stringify(event)).ltrim(key, -500, -1).expire(key, 300).exec().catch(() => {
      // The local buffer still covers this process when Redis is unavailable.
    });
  }

  private key(messageId: string): string { return `ai:stream-replay:${messageId}`; }
}

export const aiStreamBroker = new AiStreamBroker();
