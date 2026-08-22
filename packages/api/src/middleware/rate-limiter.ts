import rateLimit, { type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedis } from "../db/redis";
import { getAiConfig } from "../config/ai";

const WINDOW_MS = 15 * 60 * 1_000; // 15 minutes

/**
 * Counters live in Redis so they survive a restart and are shared across
 * instances an in-memory store would let an attacker reset their budget by
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
// makes a lot of calls page loads, react-query refetches, token refreshes —
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
 * including successful ones the abuse here is mailbox flooding, and
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
 * For endpoints that check a credential password, OTP, Google token, reset
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

const MAILBOX_FLOOD_WINDOW_MS = 60 * 60 * 1_000; // 1 hour
const MAILBOX_FLOOD_MAX = 30;

export const emailSendRateLimiter = rateLimit({
  windowMs: MAILBOX_FLOOD_WINDOW_MS,
  max: MAILBOX_FLOOD_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("email-send"),
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? "unknown",
  message: {
    error: "Too many emails sent please wait before sending more.",
  },
});

/**
 * Scheduling a meeting sends the investor a calendar invite email, same
 * mailbox-flooding surface as emailSendRateLimiter same cap, same per-user
 * keying, its own budget.
 */
export const scheduleMeetingRateLimiter = rateLimit({
  windowMs: MAILBOX_FLOOD_WINDOW_MS,
  max: MAILBOX_FLOOD_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("schedule-meeting"),
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? "unknown",
  message: {
    error: "Too many meetings scheduled please wait before scheduling more.",
  },
});

/**
 * Same Redis-backed counters as emailSendRateLimiter / scheduleMeetingRateLimiter
 * (identical key prefix, so hits are additive with the manual endpoint's own),
 * consumed directly rather than as Express middleware. approveAction has no
 * req/res to run a limiter against, and which of these two budgets applies
 * depends on the proposal's actionType only known once the row is loaded
 * inside the service, not from the route alone. Without this, approving an
 * AI-drafted send/schedule was a way around the manual endpoint's own cap.
 */
export async function consumeMailboxFloodLimit(prefix: "email-send" | "schedule-meeting", userId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `rl:${prefix}:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.pexpire(key, MAILBOX_FLOOD_WINDOW_MS);
  return count <= MAILBOX_FLOOD_MAX;
}

/**
 * Guards `/access` and `/verify`. These were unrated before an invitation
 * could carry a password — a brute-forceable secret checked entirely
 * server-side, with no OTP delivery step to slow an attacker down. IP-keyed
 * since there's no session yet at this point.
 */
export const reviewerAccessRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1_000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("reviewer-access"),
  keyGenerator: (req) => req.ip ?? "unknown",
  message: {
    error: "Too many attempts, please wait before retrying.",
  },
});

/**
 * Reviewer capture-deterrent events (copy/print/screenshot attempts) come
 * from an unauthenticated-by-us client script, not a trusted app a hostile
 * reviewer could script a flood of "attempts" to fill the log with noise.
 * These are discrete user actions, not a heartbeat stream, so the cap is
 * generous relative to the global limiter but still bounded per session.
 */
export const reviewerEventRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1_000,
  max: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("reviewer-event"),
  keyGenerator: (req) => req.reviewer?.sessionId ?? req.ip ?? "unknown",
  message: {
    error: "Too many events reported, please wait before retrying.",
  },
});

/**
 * Engagement heartbeat flushes land roughly every 10s, so ~30/5min is the
 * legitimate ceiling; 60 leaves slack for pagehide/visibility flushes firing
 * close together without opening the door to a flood.
 */
export const reviewerTelemetryRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1_000,
  max: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("reviewer-telemetry"),
  keyGenerator: (req) => req.reviewer?.sessionId ?? req.ip ?? "unknown",
  message: {
    error: "Too many telemetry updates, please wait before retrying.",
  },
});

/**
 * AI prompts have a separate, deliberately small user budget. It prevents a
 * single member from exhausting model capacity while leaving ordinary API
 * traffic governed by the global limiter above.
 */
export const aiMessageRateLimiter = rateLimit({
  windowMs: 60 * 1_000,
  limit: () => getAiConfig().messagesPerMinute,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("ai-message"),
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? "unknown",
  message: {
    code: "AI_MESSAGE_RATE_LIMITED",
    error: "AI message limit reached. Please wait a moment before trying again.",
  },
});
