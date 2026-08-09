import { beforeEach, describe, expect, it, vi } from "vitest";

const patch = vi.fn();
vi.mock("../../lib/api-client", () => ({ apiClient: { patch: (...a: unknown[]) => patch(...a) } }));

const { completeFollowup } = await import("../../lib/interaction-log-api");

beforeEach(() => {
  vi.clearAllMocks();
  patch.mockResolvedValue({ data: { data: { id: "log-1" } } });
});

describe("completeFollowup", () => {
  it("marks the follow-up done without clearing the date it was due", async () => {
    await completeFollowup("startup-1", "log-1");

    const [url, body] = patch.mock.calls[0];
    expect(url).toBe("/startups/startup-1/interaction-logs/log-1");
    expect(body.followupCompletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Nulling nextFollowupDate would erase the record that a step was ever
    // planned, and the API reopens the follow-up when that field is sent.
    expect(body).not.toHaveProperty("nextFollowupDate");
  });
});
