import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

import { Worker } from "bullmq";
import { getRedis } from "../queue";
import { emailJob } from "./email.worker";
import { embeddingsJob } from "./embeddings.worker";

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

// Entry point — only runs when executed directly
if (require.main === module) {
  const workers = startWorkers();
  console.info(`Workers running: ${workers.map((w) => w.name).join(", ")}`);

  async function shutdown(signal: string): Promise<void> {
    console.info(`\nReceived ${signal}, shutting down...`);
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (err) => {
    console.error("Unhandled rejection:", err);
    process.exit(1);
  });
}
