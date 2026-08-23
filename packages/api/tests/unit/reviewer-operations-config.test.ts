import { getReviewerOperationsConfig } from "../../src/config/reviewer-operations";

const KEYS = [
  "METRICS_ENABLED",
  "METRICS_TOKEN",
  "REVIEWER_CHALLENGE_RETENTION_HOURS",
  "REVIEWER_NETWORK_RETENTION_DAYS",
  "REVIEWER_ENGAGEMENT_RETENTION_DAYS",
  "REVIEWER_EVENT_RETENTION_DAYS",
] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => KEYS.forEach((key) => delete process.env[key]));
afterAll(() => KEYS.forEach((key) => {
  const value = original[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}));

it("uses explicit privacy-safe defaults", () => {
  expect(getReviewerOperationsConfig()).toMatchObject({
    challengeRetentionHours: 24,
    networkRetentionDays: 30,
    engagementRetentionDays: 365,
    eventRetentionDays: 365,
    metricsEnabled: false,
  });
});

it("rejects enabled metrics without a strong dedicated token", () => {
  process.env.METRICS_ENABLED = "true";
  process.env.METRICS_TOKEN = "short";
  expect(() => getReviewerOperationsConfig()).toThrow("METRICS_TOKEN must be at least 32 characters");
});
