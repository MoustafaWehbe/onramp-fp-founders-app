import { getAiConfig } from "./ai";
import { getReviewerOperationsConfig } from "./reviewer-operations";
import { logger } from "../utils/logger";

const REQUIRED: Record<string, string[]> = {
  always: [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "OTP_HMAC_SECRET",
  ],
  production: [
    "RESEND_API_KEY",
    "RESEND_FROM",
    "GOOGLE_CLIENT_ID",
  ],
  // Only required once a deployment actually offers the Google integration —
  // most self-hosted Raise instances will never set these, and
  // login-with-Google must keep working without them.
  googleIntegration: [
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_TOKEN_ENCRYPTION_KEY",
  ],
};

/**
 * Whether this deployment has Google Calendar/Gmail integration configured.
 * Checked at call time (not cached) so tests can toggle it by setting env vars.
 */
export function isGoogleIntegrationEnabled(): boolean {
  return REQUIRED.googleIntegration.every((key) => Boolean(process.env[key]));
}

export function getGoogleRedirectUri(): string {
  const uri = process.env.GOOGLE_REDIRECT_URI;
  if (uri) return uri;
  // Dev fallback: the API is reached through the frontend's dev-server proxy,
  // so the redirect Google is sent back to must be the frontend origin too.
  return `${getAppUrl()}/api/v1/integrations/google/callback`;
}

export function getAppUrl(): string {
  const raw = process.env.APP_URL ?? process.env.CORS_ORIGIN;

  if (!raw) {
    throw new Error("APP_URL is not set (CORS_ORIGIN is unset too) cannot build email links");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`APP_URL must be an absolute URL, got "${raw}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`APP_URL must use http or https, got "${raw}"`);
  }

  return raw.replace(/\/+$/, "");
}

/**
 * How many reverse proxies sit in front of this process, as an Express
 * `trust proxy` value.
 *
 * This drives `req.ip`, which is what every rate limiter keys on. Get it wrong
 * in either direction and the limiters break: too low and every request behind
 * a load balancer shares the proxy's IP, so one attacker locks out all users;
 * too high (or `true`) and a client can forge `X-Forwarded-For` to present a
 * fresh IP on every request and never be limited at all.
 *
 * Defaults to 0 trust nothing which is correct for local development and
 * for a process exposed directly. Set TRUST_PROXY to the number of hops you
 * actually run behind (typically 1 for a single nginx/ALB/Cloudflare layer).
 */
export function getTrustProxy(): number | string | boolean {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return 0;

  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 0) return hops;

  // Anything else is treated as a comma-separated list of trusted addresses or
  // subnets, which Express parses itself. `true` is deliberately not special-
  // cased spell out the hop count or the addresses instead.
  return raw;
}

export function validateEnv(): void {
  const problems: string[] = [];

  for (const key of REQUIRED.always) {
    if (!process.env[key]) problems.push(`Missing ${key}`);
  }

  if (process.env.NODE_ENV === "production") {
    for (const key of REQUIRED.production) {
      if (!process.env[key]) problems.push(`Missing ${key}`);
    }
  }

  try {
    getAppUrl();
  } catch (err) {
    problems.push((err as Error).message);
  }

  // Partial Google-integration config is worse than none: it would let a
  // connect attempt start and fail deep inside the OAuth exchange instead of
  // at boot. Either every var is set, or none are.
  const googleVarsSet = REQUIRED.googleIntegration.filter((key) => Boolean(process.env[key]));
  if (googleVarsSet.length > 0 && googleVarsSet.length < REQUIRED.googleIntegration.length) {
    const missing = REQUIRED.googleIntegration.filter((key) => !process.env[key]);
    problems.push(
      `Partial Google integration config: set ${missing.join(", ")} too, or unset ${googleVarsSet.join(", ")}`,
    );
  }

  const encryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (encryptionKey && !/^[0-9a-f]{64}$/i.test(encryptionKey)) {
    problems.push("GOOGLE_TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }

  try {
    // Keep feature-flagged AI configuration invalid at boot rather than
    // discovering it only after a user starts a request.
    getAiConfig();
  } catch (err) {
    problems.push((err as Error).message);
  }

  try {
    getReviewerOperationsConfig();
  } catch (err) {
    problems.push((err as Error).message);
  }

  if (problems.length > 0) {
    logger.error({ problems }, "Invalid environment configuration");
    process.exit(1);
  }
}
