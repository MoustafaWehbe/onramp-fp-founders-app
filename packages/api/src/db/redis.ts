import IORedis from "ioredis";

// Shared by the job queues and rate limiters. Realtime publish uses its own
// client (see createRealtimePublisher) so a Redis outage cannot grow an
// unbounded offline queue of fire-and-forget SSE fan-out. Lives here rather
// than in jobs/queue so that importing it does not also pull in the workers
// and with them config/email, whose Resend client throws at construction when
// RESEND_API_KEY is unset.
let redis: IORedis | null = null;
let realtimePublisher: IORedis | null = null;

const redisUrl = () => process.env.REDIS_URL ?? "redis://localhost:6379";

/** Fresh connection. Needed for Redis subscribe mode, which monopolizes a socket. */
export function createRedis(): IORedis {
  return new IORedis(redisUrl(), {
    maxRetriesPerRequest: null,
  });
}

/**
 * Dedicated publisher for SSE fan-out. Bounded retries and no offline queue so
 * a Redis outage drops events instead of buffering them forever in memory.
 */
export function createRealtimePublisher(): IORedis {
  if (!realtimePublisher) {
    realtimePublisher = new IORedis(redisUrl(), {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
  }
  return realtimePublisher;
}

export function getRedis(): IORedis {
  if (!redis) {
    redis = createRedis();
  }
  return redis;
}
