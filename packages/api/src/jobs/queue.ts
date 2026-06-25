import { Queue } from "bullmq";
import IORedis from "ioredis";
import { emailJob, type EmailJobData } from "./workers/email.worker";
import { embeddingsJob, type EmbeddingsJobData } from "./workers/embeddings.worker";

// ─── Redis singleton (shared with workers) ────────────────────────────────────

let redis: IORedis | null = null;

export function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return redis;
}

// ─── Queue factory ────────────────────────────────────────────────────────────

function makeQueue<T>(name: string): Queue<T> {
  return new Queue<T>(name, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });
}

// ─── Queue instances (import these in routes/services to enqueue jobs) ────────

export const emailQueue = makeQueue<EmailJobData>(emailJob.name);
export const embeddingsQueue = makeQueue<EmbeddingsJobData>(embeddingsJob.name);
