import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { prisma } from "./src/lib/prisma";
import { startWorkers } from "./src/jobs/queue";

async function main(): Promise<void> {
  console.info("Starting workers...");

  await prisma.$connect();
  const workers = startWorkers();

  console.info(
    `Started ${workers.length} worker(s): ${workers.map((w) => w.name).join(", ")}`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`\nReceived ${signal}, shutting down...`);
    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Workers failed to start:", err);
  process.exit(1);
});
