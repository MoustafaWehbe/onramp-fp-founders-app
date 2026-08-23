import pino from "pino";

/**
 * Shared structured logger. JSON in production/test (for log aggregation);
 * pretty-printed in development. Level is runtime-configurable via LOG_LEVEL
 * so an incident can be debugged without a redeploy.
 */
export const logger = pino({
  // Tests previously silenced console.info/log but left console.error/warn
  // visible; "warn" preserves that same quiet-but-not-silent test output.
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "warn" : "info"),
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" } }
      : undefined,
});
