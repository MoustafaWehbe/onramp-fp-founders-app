const REQUIRED: Record<string, string[]> = {
  always: [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
  ],
  production: [
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
  ],
};

export function validateEnv(): void {
  const missing: string[] = [];

  for (const key of REQUIRED.always) {
    if (!process.env[key]) missing.push(key);
  }

  if (process.env.NODE_ENV === "production") {
    for (const key of REQUIRED.production) {
      if (!process.env[key]) missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing required environment variables:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }
}
