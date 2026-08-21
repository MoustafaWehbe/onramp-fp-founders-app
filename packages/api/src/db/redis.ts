import IORedis from "ioredis";

// Shared by the job queues and the rate limiters. It lives here rather than in
// jobs/queue so that importing it does not also pull in the workers and with
// them config/email, whose Resend client throws at construction when
// RESEND_API_KEY is unset.
let redis: IORedis | null = null;

export function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (!redis) return;
  const connection = redis;
  redis = null;
  await connection.quit();
}
