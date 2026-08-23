const DEFAULT_CHALLENGE_RETENTION_HOURS = 24;
const DEFAULT_NETWORK_RETENTION_DAYS = 30;
const DEFAULT_ENGAGEMENT_RETENTION_DAYS = 365;
const DEFAULT_EVENT_RETENTION_DAYS = 365;

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function booleanValue(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export interface ReviewerOperationsConfig {
  challengeRetentionHours: number;
  networkRetentionDays: number;
  engagementRetentionDays: number;
  eventRetentionDays: number;
  metricsEnabled: boolean;
  metricsToken: string | null;
}

/** Read at call time so deployments and tests get deterministic validation. */
export function getReviewerOperationsConfig(): ReviewerOperationsConfig {
  const metricsEnabled = booleanValue("METRICS_ENABLED", false);
  const metricsToken = process.env.METRICS_TOKEN?.trim() || null;

  if (metricsEnabled && (!metricsToken || metricsToken.length < 32)) {
    throw new Error("METRICS_TOKEN must be at least 32 characters when METRICS_ENABLED=true");
  }

  return {
    challengeRetentionHours: positiveInteger(
      "REVIEWER_CHALLENGE_RETENTION_HOURS",
      DEFAULT_CHALLENGE_RETENTION_HOURS,
    ),
    networkRetentionDays: positiveInteger(
      "REVIEWER_NETWORK_RETENTION_DAYS",
      DEFAULT_NETWORK_RETENTION_DAYS,
    ),
    engagementRetentionDays: positiveInteger(
      "REVIEWER_ENGAGEMENT_RETENTION_DAYS",
      DEFAULT_ENGAGEMENT_RETENTION_DAYS,
    ),
    eventRetentionDays: positiveInteger(
      "REVIEWER_EVENT_RETENTION_DAYS",
      DEFAULT_EVENT_RETENTION_DAYS,
    ),
    metricsEnabled,
    metricsToken,
  };
}
