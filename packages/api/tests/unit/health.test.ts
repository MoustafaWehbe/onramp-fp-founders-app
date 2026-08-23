import request from "supertest";

const queryRaw = jest.fn();
const ping = jest.fn();

jest.mock("../../src/db/prisma", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));

jest.mock("../../src/db/redis", () => ({
  getRedis: () => ({ ping: (...args: unknown[]) => ping(...args) }),
}));

jest.mock("../../src/jobs/queue", () => {
  const queue = { add: jest.fn() };
  return {
    emailQueue: queue,
    embeddingsQueue: queue,
    documentProcessingQueue: queue,
    documentRasterizeQueue: queue,
    calendarSyncQueue: queue,
    gmailLogRetryQueue: queue,
    aiAnalysisQueue: queue,
  };
});

import { app } from "../../app";
import {
  recordReviewerRateLimit,
  recordReviewerRetentionRun,
  resetReviewerMetricsForTests,
} from "../../src/observability/reviewer-metrics";

const ORIGINAL_METRICS_ENABLED = process.env.METRICS_ENABLED;
const ORIGINAL_METRICS_TOKEN = process.env.METRICS_TOKEN;

beforeEach(() => {
  jest.clearAllMocks();
  queryRaw.mockResolvedValue([{ value: 1 }]);
  ping.mockResolvedValue("PONG");
  delete process.env.METRICS_ENABLED;
  delete process.env.METRICS_TOKEN;
  resetReviewerMetricsForTests();
});

afterAll(() => {
  if (ORIGINAL_METRICS_ENABLED === undefined) delete process.env.METRICS_ENABLED;
  else process.env.METRICS_ENABLED = ORIGINAL_METRICS_ENABLED;
  if (ORIGINAL_METRICS_TOKEN === undefined) delete process.env.METRICS_TOKEN;
  else process.env.METRICS_TOKEN = ORIGINAL_METRICS_TOKEN;
});

describe("service health probes", () => {
  it("keeps liveness independent of downstream dependencies", async () => {
    queryRaw.mockRejectedValue(new Error("database unavailable"));
    ping.mockRejectedValue(new Error("redis unavailable"));

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(queryRaw).not.toHaveBeenCalled();
    expect(ping).not.toHaveBeenCalled();
  });

  it("reports ready only when PostgreSQL and Redis both respond", async () => {
    const response = await request(app).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ready",
      checks: { database: "ok", redis: "ok" },
    });
  });

  it("returns 503 without exposing dependency errors", async () => {
    queryRaw.mockRejectedValue(new Error("secret database detail"));

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: "not_ready",
      checks: { database: "unavailable", redis: "ok" },
    });
    expect(JSON.stringify(response.body)).not.toContain("secret database detail");
  });
});

describe("operational metrics", () => {
  const token = "a-secure-metrics-token-that-is-32-characters";

  it("does not expose the endpoint when metrics are disabled", async () => {
    expect((await request(app).get("/metrics")).status).toBe(404);
  });

  it("requires the dedicated bearer token and exports bounded reviewer metrics", async () => {
    process.env.METRICS_ENABLED = "true";
    process.env.METRICS_TOKEN = token;
    recordReviewerRateLimit("download");
    recordReviewerRetentionRun("success", { sessionNetworkDataRedacted: 2 });
    await request(app).post("/api/v1/reviewer-portal/access").send({});

    expect((await request(app).get("/metrics")).status).toBe(401);
    const response = await request(app).get("/metrics").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.text).toContain('raise_reviewer_rate_limit_hits_total{scope="download"} 1');
    expect(response.text).toContain(
      'raise_reviewer_portal_http_requests_total{operation="access",status_class="4xx"} 1',
    );
    expect(response.text).toContain(
      'raise_reviewer_retention_records_total{action="sessionNetworkDataRedacted"} 2',
    );
    expect(response.text).not.toContain("reviewerInvitationId");
  });
});
