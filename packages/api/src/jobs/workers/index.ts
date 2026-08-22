import "dotenv/config";

import { Worker, type Processor } from "bullmq";
import { getRedis } from "../queue";
import { emailJob } from "./email.worker";
import { embeddingsJob } from "./embeddings.worker";
import { documentProcessingJob } from "./document-processing.worker";
import { documentRasterizeJob } from "./document-rasterize.worker";
import { calendarSyncJob } from "./calendar-sync.worker";
import { gmailLogRetryJob } from "./gmail-log-retry.worker";
import { aiAnalysisJob } from "./ai-analysis.worker";
import { prisma } from "../../db/prisma";
import { closeRedis } from "../../db/redis";
import { logger } from "../../utils/logger";

interface WorkerDef {
  name: string;
  concurrency: number;
  process: Processor;
}

const JOBS: WorkerDef[] = [
  emailJob,
  embeddingsJob,
  documentProcessingJob,
  documentRasterizeJob,
  calendarSyncJob,
  gmailLogRetryJob,
  aiAnalysisJob,
];

export function startWorkers(): Worker[] {
  const conn = getRedis();

  const workers = JOBS.map(
    ({ name, concurrency, process }) =>
      new Worker(name, process, { connection: conn, concurrency }),
  );

  workers.forEach((w) => {
    w.on("completed", (job) => logger.info({ worker: w.name, jobId: job.id }, "job done"));
    w.on("failed", (job, err) => logger.error({ worker: w.name, jobId: job?.id, err }, "job failed"));
    w.on("error", (err) => logger.error({ worker: w.name, err }, "worker error"));
  });

  logger.info({ workers: workers.map((w) => w.name) }, "Workers running");
  return workers;
}

// Entry point only runs when executed directly
if (require.main === module) {
  const workers = startWorkers();
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Received shutdown signal, shutting down...");
    const results = await Promise.allSettled(workers.map((worker) => worker.close()));
    await Promise.allSettled([closeRedis(), prisma.$disconnect()]);
    const failed = results.some((result) => result.status === "rejected");
    if (failed) logger.error({ results }, "One or more workers failed to close cleanly");
    process.exitCode = failed ? 1 : 0;
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (err) => {
    logger.error({ err }, "Unhandled rejection");
    process.exit(1);
  });
}
