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
};

export function getAppUrl(): string {
  const raw = process.env.APP_URL ?? process.env.CORS_ORIGIN;

  if (!raw) {
    throw new Error("APP_URL is not set (CORS_ORIGIN is unset too) — cannot build email links");
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
 * Defaults to 0 — trust nothing — which is correct for local development and
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
  // cased — spell out the hop count or the addresses instead.
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

  if (problems.length > 0) {
    console.error(`Invalid environment configuration:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
}
