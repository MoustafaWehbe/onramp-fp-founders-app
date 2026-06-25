import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { startWorkers } from "./src/jobs";

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
