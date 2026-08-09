import { Queue } from "bullmq";
import { emailJob } from "./workers/email.worker";
import type { EmailJobData } from "../types";
import { embeddingsJob, type EmbeddingsJobData } from "./workers/embeddings.worker";

// The Redis singleton now lives in db/redis so non-job callers (the rate
// limiters) can share it without importing the workers. Re-exported here
// because the workers still reach for it through this module.
export { getRedis } from "../db/redis";

import { getRedis } from "../db/redis";

// Queue factory

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


export const emailQueue = makeQueue<EmailJobData>(emailJob.name);
export const embeddingsQueue = makeQueue<EmbeddingsJobData>(embeddingsJob.name);
