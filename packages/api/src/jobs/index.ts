import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { emailJob, type EmailJobData } from "./email.job";
import { embeddingsJob, type EmbeddingsJobData } from "./embeddings.job";

// ─── Redis (internal) ─────────────────────────────────────────────────────────

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return redis;
}

// ─── Queue factory (internal) ─────────────────────────────────────────────────

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

// ─── Queues (used by API to enqueue jobs) ─────────────────────────────────────

export const emailQueue = makeQueue<EmailJobData>(emailJob.name);
export const embeddingsQueue = makeQueue<EmbeddingsJobData>(embeddingsJob.name);

// ─── Workers (used by worker.ts process) ──────────────────────────────────────

const JOBS = [emailJob, embeddingsJob];

export function startWorkers(): Worker[] {
  const conn = getRedis();

  const workers = JOBS.map(
    ({ name, concurrency, process }) =>
      new Worker(name, process, { connection: conn, concurrency }),
  );

  workers.forEach((w) => {
    w.on("completed", (job) => console.info(`[${w.name}] job ${job.id} done`));
    w.on("failed", (job, err) => console.error(`[${w.name}] job ${job?.id} failed:`, err.message));
    w.on("error", (err) => console.error(`[${w.name}] error:`, err));
  });

  return workers;
}
