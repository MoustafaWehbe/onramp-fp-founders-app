const REQUIRED: Record<string, string[]> = {
  always: [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "OTP_HMAC_SECRET",
    "GOOGLE_CLIENT_ID",
  ],
  production: [
    "RESEND_API_KEY",
    "RESEND_FROM",
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
