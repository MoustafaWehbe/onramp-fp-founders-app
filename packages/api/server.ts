import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, ".env") });

import { validateEnv } from "./src/config/env";
validateEnv();

import { app } from "./app";
import { prisma } from "./src/db/prisma";
import { startWorkers } from "./src/jobs/workers/index";
import { startCronJobs } from "./src/jobs/cron";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function start(): Promise<void> {
  try {
    await prisma.$connect();
    console.info("Database connection established");

    app.listen(PORT, () => {
      console.info(`API server running on http://localhost:${PORT}`);
      console.info(`Health check: http://localhost:${PORT}/health`);
    });

    startWorkers();
    startCronJobs();
  } catch (error) {
    console.error("Failed to start server:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

start();
