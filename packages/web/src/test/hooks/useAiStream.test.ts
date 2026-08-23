import { describe, expect, it } from "vitest";
import { aiReconnectDelayMs } from "../../hooks/useAiStream";

describe("AI SSE reconnect backoff", () => {
  it("grows exponentially and caps the base delay at fifteen seconds", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => aiReconnectDelayMs(attempt, 0))).toEqual([
      750, 1_500, 3_000, 6_000, 12_000, 15_000, 15_000,
    ]);
  });

  it("adds at most 300ms of jitter", () => {
    expect(aiReconnectDelayMs(2, 1)).toBe(3_300);
    expect(aiReconnectDelayMs(2, -1)).toBe(3_000);
  });
});
