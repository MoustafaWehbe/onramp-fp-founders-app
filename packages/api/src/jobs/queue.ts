import { Queue } from "bullmq";
import { emailJob } from "./workers/email.worker";
import type { EmailJobData } from "../types";
import { embeddingsJob, type EmbeddingsJobData } from "./workers/embeddings.worker";
import {
  documentProcessingJob,
  type DocumentProcessingJobData,
} from "./workers/document-processing.worker";
import {
  documentRasterizeJob,
  type DocumentRasterizeJobData,
} from "./workers/document-rasterize.worker";
import { calendarSyncJob, type CalendarSyncJobData } from "./workers/calendar-sync.worker";
import { gmailLogRetryJob, type GmailLogRetryJobData } from "./workers/gmail-log-retry.worker";
import { aiAnalysisJob, type AiAnalysisJobData } from "./workers/ai-analysis.worker";

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
export const documentProcessingQueue = makeQueue<DocumentProcessingJobData>(
  documentProcessingJob.name,
);
export const documentRasterizeQueue = makeQueue<DocumentRasterizeJobData>(
  documentRasterizeJob.name,
);
export const calendarSyncQueue = makeQueue<CalendarSyncJobData>(calendarSyncJob.name);
export const gmailLogRetryQueue = makeQueue<GmailLogRetryJobData>(gmailLogRetryJob.name);
export const aiAnalysisQueue = makeQueue<AiAnalysisJobData>(aiAnalysisJob.name);
