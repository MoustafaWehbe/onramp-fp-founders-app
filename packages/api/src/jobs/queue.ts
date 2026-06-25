import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_NAMES, type EmailJobData, type EmbeddingsJobData } from "../types";
import { processEmailJob } from "./email.job";
import { processEmbeddingsJob } from "./embeddings.job";

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return redis;
}

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

export const emailQueue = makeQueue<EmailJobData>(QUEUE_NAMES.EMAIL);
export const embeddingsQueue = makeQueue<EmbeddingsJobData>(QUEUE_NAMES.EMBEDDINGS);

export function startWorkers(): Worker[] {
  const conn = getRedis();

  const workers = [
    new Worker(QUEUE_NAMES.EMAIL, processEmailJob, { connection: conn, concurrency: 10 }),
    new Worker(QUEUE_NAMES.EMBEDDINGS, processEmbeddingsJob, { connection: conn, concurrency: 5 }),
  ];

  workers.forEach((w) => {
    w.on("completed", (job) => console.info(`[${w.name}] job ${job.id} done`));
    w.on("failed", (job, err) => console.error(`[${w.name}] job ${job?.id} failed:`, err.message));
    w.on("error", (err) => console.error(`[${w.name}] error:`, err));
  });

  return workers;
}
