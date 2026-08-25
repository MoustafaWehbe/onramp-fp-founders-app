import { Queue, type JobsOptions, type RepeatOptions } from "bullmq";
import type { EmailJobData } from "../types";
import type { EmbeddingsJobData } from "./workers/embeddings.worker";
import type { DocumentProcessingJobData } from "./workers/document-processing.worker";
import type { DocumentRasterizeJobData } from "./workers/document-rasterize.worker";
import type { CalendarSyncJobData } from "./workers/calendar-sync.worker";
import type { GmailLogRetryJobData } from "./workers/gmail-log-retry.worker";
import type { AiAnalysisJobData } from "./workers/ai-analysis.worker";
import type { ScheduledTaskJobData } from "./workers/scheduled-tasks.worker";
import { JOB_NAMES } from "./job-names";

// The Redis singleton now lives in db/redis so non-job callers (the rate
// limiters) can share it without importing the workers. Re-exported here
// because the workers still reach for it through this module.
export { getRedis } from "../db/redis";

import { getRedis } from "../db/redis";

type BullQueue<T> = Queue<T, unknown, string, T, unknown, string>;

class LazyQueue<T> {
  private queue: BullQueue<T> | undefined;

  constructor(private readonly name: string) {}

  private getQueue(): BullQueue<T> {
    this.queue ??= new Queue<T, unknown, string, T, unknown, string>(this.name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
    return this.queue;
  }

  add(name: string, data: T, options?: JobsOptions) {
    return this.getQueue().add(name, data, options);
  }

  /**
   * Registers (or updates in place — this is an idempotent upsert, safe to
   * call on every process boot) a recurring job. BullMQ v6 replaced the old
   * `add(name, data, { repeat })` pattern with this "Job Scheduler" API;
   * `schedulerId` is this schedule's own stable identity, distinct from the
   * job name each produced job instance carries.
   */
  upsertJobScheduler(schedulerId: string, repeatOptions: Omit<RepeatOptions, "key">, jobName: string, data: T) {
    return this.getQueue().upsertJobScheduler(schedulerId, repeatOptions, { name: jobName, data });
  }

  async close(): Promise<void> {
    const queue = this.queue;
    this.queue = undefined;
    if (queue) await queue.close();
  }
}

function makeQueue<T>(name: string): LazyQueue<T> {
  return new LazyQueue<T>(name);
}

export const emailQueue = makeQueue<EmailJobData>(JOB_NAMES.email);
export const embeddingsQueue = makeQueue<EmbeddingsJobData>(JOB_NAMES.embeddings);
export const documentProcessingQueue = makeQueue<DocumentProcessingJobData>(
  JOB_NAMES.documentProcessing,
);
export const documentRasterizeQueue = makeQueue<DocumentRasterizeJobData>(
  JOB_NAMES.documentRasterize,
);
export const calendarSyncQueue = makeQueue<CalendarSyncJobData>(JOB_NAMES.calendarSync);
export const gmailLogRetryQueue = makeQueue<GmailLogRetryJobData>(JOB_NAMES.gmailLogRetry);
export const aiAnalysisQueue = makeQueue<AiAnalysisJobData>(JOB_NAMES.aiAnalysis);
export const scheduledTasksQueue = makeQueue<ScheduledTaskJobData>(JOB_NAMES.scheduledTasks);

const queues = [
  emailQueue,
  embeddingsQueue,
  documentProcessingQueue,
  documentRasterizeQueue,
  calendarSyncQueue,
  gmailLogRetryQueue,
  aiAnalysisQueue,
  scheduledTasksQueue,
];

export async function closeQueues(): Promise<void> {
  await Promise.all(queues.map((queue) => queue.close()));
}
