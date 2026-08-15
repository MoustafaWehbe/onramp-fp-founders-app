import rateLimit, { type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedis } from "../db/redis";

const WINDOW_MS = 15 * 60 * 1_000; // 15 minutes

/**
 * Counters live in Redis so they survive a restart and are shared across
 * instances — an in-memory store would let an attacker reset their budget by
 * waiting for a deploy, or spread attempts across replicas.
 *
 * Tests run without Redis and each limiter needs its own isolated counter, so
 * they fall back to express-rate-limit's built-in memory store.
 */
function makeStore(prefix: string): Store | undefined {
  if (process.env.NODE_ENV === "test") return undefined;

  const redis = getRedis();
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<never>,
  });
}

// Broad ceiling for the whole API. An authenticated SPA session legitimately
// makes a lot of calls — page loads, react-query refetches, token refreshes —
// so this is sized to stop scraping, not to police normal use.
export const rateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("global"),
  message: { error: "Too many requests, please try again later." },
});

/**
 * For auth endpoints that send an email on success. Every request counts,
 * including successful ones — the abuse here is mailbox flooding, and
 * registerResend in particular has no cooldown of its own, so this limiter is
 * the only thing standing between an attacker and unlimited OTP emails.
 */
export const authRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("auth"),
  message: {
    error: "Too many authentication attempts, please try again later.",
  },
});

/**
 * For endpoints that check a credential — password, OTP, Google token, reset
 * token. Only failures count (express-rate-limit treats any response < 400 as
 * a success), so this throttles brute force without ever locking out someone
 * who keeps signing in correctly.
 */
export const credentialRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("credential"),
  message: {
    error: "Too many failed attempts, please try again later.",
  },
});

export const emailSendRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000, // 1 hour
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("email-send"),
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? "unknown",
  message: {
    error: "Too many emails sent — please wait before sending more.",
  },
});

/**
 * Scheduling a meeting sends the investor a calendar invite email, same
 * mailbox-flooding surface as emailSendRateLimiter — same cap, same per-user
 * keying, its own budget.
 */
export const scheduleMeetingRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000, // 1 hour
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("schedule-meeting"),
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? "unknown",
  message: {
    error: "Too many meetings scheduled — please wait before scheduling more.",
  },
});
