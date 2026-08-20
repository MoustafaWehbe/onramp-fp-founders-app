export interface AiStreamEnvelope {
  version: 1;
  sessionId: string;
  messageId: string;
  sequence: number;
  timestamp: string;
  type: "stream.ready" | "message.started" | "message.delta" | "citation.added" | "message.snapshot" | "message.completed" | "message.failed" | "message.cancelled";
  payload: Record<string, unknown>;
}

type StreamState = { sequence: number; events: AiStreamEnvelope[]; subscribers: Set<(event: AiStreamEnvelope) => void>; };

/**
 * Bounded, process-local replay buffer. It is intentionally isolated behind a
 * broker so the Redis Streams implementation can replace it without changing
 * the SSE controller or chat service.
 */
export class AiStreamBroker {
  private readonly streams = new Map<string, StreamState>();

  publish(sessionId: string, messageId: string, type: AiStreamEnvelope["type"], payload: Record<string, unknown>): AiStreamEnvelope {
    const state = this.streams.get(messageId) ?? { sequence: 0, events: [], subscribers: new Set() };
    this.streams.set(messageId, state);
    const event: AiStreamEnvelope = { version: 1, sessionId, messageId, sequence: ++state.sequence, timestamp: new Date().toISOString(), type, payload };
    state.events.push(event);
    if (state.events.length > 500) state.events.shift();
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

  subscribe(messageId: string, subscriber: (event: AiStreamEnvelope) => void): () => void {
    const state = this.streams.get(messageId) ?? { sequence: 0, events: [], subscribers: new Set() };
    this.streams.set(messageId, state);
    state.subscribers.add(subscriber);
    return () => state.subscribers.delete(subscriber);
  }
}

export const aiStreamBroker = new AiStreamBroker();
