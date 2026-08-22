import type IORedis from "ioredis";
import { createRedis, getRedis } from "../db/redis";

/**
 * Cross-process ownership tracking for an in-flight AI generation.
 *
 * ai-conversation.service.ts used to track this with a plain in-memory Map,
 * which is correct for exactly one API process. The moment there are two:
 * a run started on process A looks orphaned from process B (no local Map
 * entry), so B's openStream call marks a perfectly healthy generation
 * AI_ORPHANED; a cancel landing on B never reaches A's AbortController; and
 * concurrentStreamsPerUser is enforced per-process instead of per-user, so
 * N replicas silently multiply the intended cap by N.
 *
 * This registry moves the three facts that matter into Redis, which every
 * process shares: is a run alive (a TTL key, refreshed by a heartbeat while
 * generating — its expiry is what makes a crashed process's run correctly
 * time out instead of staying "active" forever), how many are active for a
 * user (a set self-healed against the TTL keys), and cancellation (pub/sub,
 * so whichever process actually owns the AbortController hears about it).
 */
export interface AiRunRegistry {
  /** Marks messageId as actively generating on this process. Call once, when generation starts. */
  claim(messageId: string, userId: string): Promise<void>;
  /** Keeps the claim alive; call on an interval shorter than the TTL while generating. */
  heartbeat(messageId: string): Promise<void>;
  /** Call once from generation's finally block, regardless of outcome. */
  release(messageId: string, userId: string): Promise<void>;
  /** True if some process — this one or another — currently owns this run. */
  isActive(messageId: string): Promise<boolean>;
  /** Active run count for a user, across every process. */
  countActive(userId: string): Promise<number>;
  /** Asks whichever process owns this run to abort it. */
  requestCancel(messageId: string): Promise<void>;
  /** Registers a local handler for cancel requests targeting messageId. Returns an unsubscribe function. */
  onCancel(messageId: string, handler: () => void): () => void;
}

const RUN_TTL_SECONDS = 20;

/** Test-only: no Redis round trip, same semantics for a single process. */
class InMemoryAiRunRegistry implements AiRunRegistry {
  private readonly owners = new Map<string, string>();
  private readonly cancelHandlers = new Map<string, Set<() => void>>();

  async claim(messageId: string, userId: string): Promise<void> {
    this.owners.set(messageId, userId);
  }

  async heartbeat(): Promise<void> {}

  async release(messageId: string): Promise<void> {
    this.owners.delete(messageId);
    this.cancelHandlers.delete(messageId);
  }

  async isActive(messageId: string): Promise<boolean> {
    return this.owners.has(messageId);
  }

  async countActive(userId: string): Promise<number> {
    let count = 0;
    for (const owner of this.owners.values()) if (owner === userId) count += 1;
    return count;
  }

  async requestCancel(messageId: string): Promise<void> {
    for (const handler of [...(this.cancelHandlers.get(messageId) ?? [])]) handler();
  }

  onCancel(messageId: string, handler: () => void): () => void {
    let handlers = this.cancelHandlers.get(messageId);
    if (!handlers) {
      handlers = new Set();
      this.cancelHandlers.set(messageId, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers?.delete(handler);
      if (handlers?.size === 0) this.cancelHandlers.delete(messageId);
    };
  }
}

/**
 * Redis-backed for real deployments. Ownership is deliberately anonymous (no
 * instance id): the question openStream needs answered is only "is anyone
 * generating this right now", never "which process" — so a plain TTL key is
 * enough, and there is nothing to reconcile if a process dies without
 * releasing it (the key simply expires).
 *
 * Cancellation uses a single pattern subscription (`ai:cancel:*`) rather than
 * one channel subscribe per in-flight run: every process receives every
 * cancel request, but only the process holding a local handler for that
 * messageId (i.e. the one actually running the generation) does anything
 * with it.
 */
class RedisAiRunRegistry implements AiRunRegistry {
  private readonly redis = getRedis();
  private subscriber: IORedis | null = null;
  private readonly cancelHandlers = new Map<string, Set<() => void>>();

  private runKey(messageId: string): string {
    return `ai:run:${messageId}`;
  }

  private streamsKey(userId: string): string {
    return `ai:active-streams:${userId}`;
  }

  private cancelChannel(messageId: string): string {
    return `ai:cancel:${messageId}`;
  }

  async claim(messageId: string, userId: string): Promise<void> {
    await Promise.all([
      this.redis.set(this.runKey(messageId), "1", "EX", RUN_TTL_SECONDS),
      this.redis.sadd(this.streamsKey(userId), messageId),
    ]);
  }

  async heartbeat(messageId: string): Promise<void> {
    await this.redis.expire(this.runKey(messageId), RUN_TTL_SECONDS);
  }

  async release(messageId: string, userId: string): Promise<void> {
    await Promise.all([
      this.redis.del(this.runKey(messageId)),
      this.redis.srem(this.streamsKey(userId), messageId),
    ]);
  }

  async isActive(messageId: string): Promise<boolean> {
    return (await this.redis.exists(this.runKey(messageId))) === 1;
  }

  async countActive(userId: string): Promise<number> {
    const key = this.streamsKey(userId);
    const members = await this.redis.smembers(key);
    if (members.length === 0) return 0;
    const alive = await Promise.all(members.map((messageId) => this.redis.exists(this.runKey(messageId))));
    // A member whose run key has already expired means its owning process
    // died (crash, redeploy, hot-reload) before reaching release() in its
    // finally block. Cleaned up lazily here rather than never, since nothing
    // else ever revisits this set.
    const stale = members.filter((_, index) => alive[index] === 0);
    if (stale.length) await this.redis.srem(key, ...stale);
    return alive.filter((flag) => flag === 1).length;
  }

  async requestCancel(messageId: string): Promise<void> {
    await this.redis.publish(this.cancelChannel(messageId), "1");
  }

  onCancel(messageId: string, handler: () => void): () => void {
    let handlers = this.cancelHandlers.get(messageId);
    if (!handlers) {
      handlers = new Set();
      this.cancelHandlers.set(messageId, handlers);
    }
    handlers.add(handler);
    this.ensureSubscriber();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const set = this.cancelHandlers.get(messageId);
      set?.delete(handler);
      if (set?.size === 0) this.cancelHandlers.delete(messageId);
    };
  }

  private ensureSubscriber(): IORedis {
    if (this.subscriber) return this.subscriber;

    // A connection in subscribe mode can only run pub/sub commands, so this
    // must be a dedicated socket — never the shared getRedis() used elsewhere.
    const sub = createRedis();
    sub.on("pmessage", (_pattern, channel: string) => {
      if (!channel.startsWith("ai:cancel:")) return;
      const messageId = channel.slice("ai:cancel:".length);
      for (const handler of [...(this.cancelHandlers.get(messageId) ?? [])]) handler();
    });
    sub.on("error", (err) => console.error("[ai-run-registry] redis subscriber error:", err));
    void sub.psubscribe("ai:cancel:*").catch((err) => console.error("[ai-run-registry] failed to psubscribe:", err));

    this.subscriber = sub;
    return sub;
  }
}

function createAiRunRegistry(): AiRunRegistry {
  if (process.env.NODE_ENV === "test" || process.env.REALTIME_BUS === "memory") {
    return new InMemoryAiRunRegistry();
  }
  return new RedisAiRunRegistry();
}

export const aiRunRegistry: AiRunRegistry = createAiRunRegistry();
