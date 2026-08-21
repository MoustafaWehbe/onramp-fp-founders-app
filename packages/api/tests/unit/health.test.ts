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

beforeEach(() => {
  jest.clearAllMocks();
  queryRaw.mockResolvedValue([{ value: 1 }]);
  ping.mockResolvedValue("PONG");
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
