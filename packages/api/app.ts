import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { errorHandler } from "./src/utils/errors";
import { getTrustProxy } from "./src/config/env";
import { rateLimiter } from "./src/middleware/rate-limiter";
import { router } from "./src/routes";

const app = express();

// Must be set before any middleware reads req.ip — the rate limiters key on it.
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

// Body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
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

// Error handling (must be last)
app.use(errorHandler);

export { app };
