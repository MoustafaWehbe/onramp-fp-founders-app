import "dotenv/config";

import { validateEnv } from "./src/config/env";
validateEnv();

import { app } from "./app";
import { prisma } from "./src/db/prisma";
import { closeQueues } from "./src/jobs/queue";
import { closeRedis } from "./src/db/redis";
import type { Server } from "node:http";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.closeAllConnections();
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);
    timeout.unref();

    server.close((error) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
}

async function start(): Promise<void> {
  try {
    await prisma.$connect();
    console.info("Database connection established");

    const server = app.listen(PORT, () => {
      console.info(`API server running on http://localhost:${PORT}`);
      console.info(`Health check: http://localhost:${PORT}/health`);
      console.info(`Readiness check: http://localhost:${PORT}/ready`);
    });

    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.info(`Received ${signal}, shutting down gracefully`);

      const results = await Promise.allSettled([
        closeHttpServer(server),
        closeQueues(),
      ]);
      await Promise.allSettled([closeRedis(), prisma.$disconnect()]);

      const failed = results.some((result) => result.status === "rejected");
      if (failed) console.error("One or more resources failed to close cleanly", results);
      process.exitCode = failed ? 1 : 0;
    };

    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));
  } catch (error) {
    console.error("Failed to start server:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

start();
