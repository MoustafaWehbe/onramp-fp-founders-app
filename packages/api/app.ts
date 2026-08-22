import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { errorHandler } from "./src/utils/errors";
import { logger } from "./src/utils/logger";
import { getTrustProxy } from "./src/config/env";
import { rateLimiter } from "./src/middleware/rate-limiter";
import { router } from "./src/routes";
import { documentController } from "./src/controllers/document.controller";
import { userController } from "./src/controllers/user.controller";
import { authenticate } from "./src/middleware/auth";
import { prisma } from "./src/db/prisma";
import { getRedis } from "./src/db/redis";

const app = express();
const READINESS_TIMEOUT_MS = 2_000;

function withReadinessTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Readiness check timed out")),
      READINESS_TIMEOUT_MS,
    );
    timeout.unref();
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

// Must be set before any middleware reads req.ip the rate limiters key on it.
app.set("trust proxy", getTrustProxy());

// Security
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  }),
);

// Cookie parsing
app.use(cookieParser());

// Local document uploads are raw bytes — must be registered before express.json().
app.put(
  "/api/v1/documents/local-upload/:token",
  express.raw({ type: () => true, limit: "21mb" }),
  documentController.localUpload,
);

// Same reason: the browser PUTs raw image bytes, not JSON. Unlike the
// token-gated route above this is a normal authenticated write, so it gets
// its own rate-limit call registering it ahead of the global limiter means
// it would otherwise run unthrottled.
app.put(
  "/api/v1/users/me/avatar",
  rateLimiter,
  authenticate,
  express.raw({ type: () => true, limit: "2mb" }),
  userController.uploadAvatar,
);

// Body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Logging (structured JSON in production so it's aggregation-friendly; pretty-printed in dev)
if (process.env.NODE_ENV !== "test") {
  app.use(pinoHttp({ logger }));
}

// Every API response is scoped to the caller's session. Letting a browser or
// an intermediary hold on to one risks replaying it for whoever signs in next.
app.use("/api/v1", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Rate limiting
app.use("/api/v1/", rateLimiter);

// Routes
app.use("/api/v1", router);

// OpenAPI / Swagger UI
const openApiSpec = yaml.load(
  fs.readFileSync(path.join(__dirname, "openapi.yaml"), "utf8"),
) as object;
app.get("/api/openapi.yaml", (_req, res) =>
  res.sendFile(path.join(__dirname, "openapi.yaml")),
);
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Readiness is dependency-aware: load balancers should stop routing new work
// here if either persistence layer is unavailable, while /health remains a
// process-only liveness probe that can still diagnose a wedged dependency.
app.get("/ready", async (_req, res) => {
  const [database, redis] = await Promise.allSettled([
    withReadinessTimeout(prisma.$queryRaw`SELECT 1`),
    withReadinessTimeout(getRedis().ping()),
  ]);
  const checks = {
    database: database.status === "fulfilled" ? "ok" : "unavailable",
    redis: redis.status === "fulfilled" ? "ok" : "unavailable",
  };
  const ready = checks.database === "ok" && checks.redis === "ok";
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    checks,
    timestamp: new Date().toISOString(),
  });
});

// Error handling (must be last)
app.use(errorHandler);

export { app };
