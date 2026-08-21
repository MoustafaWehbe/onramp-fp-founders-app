import IORedis from "ioredis";

// Shared by the job queues, rate limiters, and realtime pub/sub publisher.
// It lives here rather than in jobs/queue so that importing it does not also
// pull in the workers and with them config/email, whose Resend client throws
// at construction when RESEND_API_KEY is unset.
let redis: IORedis | null = null;

/** Fresh connection. Needed for Redis subscribe mode, which monopolizes a socket. */
export function createRedis(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
}

export function getRedis(): IORedis {
  if (!redis) {
    redis = createRedis();
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (!redis) return;
  const connection = redis;
  redis = null;
  await connection.quit();
}
