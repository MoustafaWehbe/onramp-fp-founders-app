import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("../../lib/api-client", () => ({
  apiClient: { get },
}));

const { listReviewerInvitationActivity } = await import("../../lib/reviewer-api");

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({
    data: {
      data: [],
      pagination: { hasMore: false, nextCursor: null },
    },
  });
});

describe("listReviewerInvitationActivity", () => {
  it("passes an opaque cursor and preserves pagination metadata", async () => {
    const result = await listReviewerInvitationActivity("startup-1", "invitation-1", {
      limit: 25,
      cursor: "next_cursor",
    });

    expect(get).toHaveBeenCalledWith(
      "/startups/startup-1/reviewer-invitations/invitation-1/activity",
      { params: { limit: 25, cursor: "next_cursor" } },
    );
    expect(result.pagination).toEqual({ hasMore: false, nextCursor: null });
  });
});
