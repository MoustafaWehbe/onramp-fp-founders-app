import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock("../../lib/api-client", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
}));

const { createCommitment, listCommitments, listFundraisingRounds } = await import("../../lib/fundraising-api");

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { data: [], meta: {} } });
  post.mockResolvedValue({ data: { data: { id: "commitment-1" } } });
});

describe("fundraising API client", () => {
  it("uses startup-scoped financial routes", async () => {
    await listFundraisingRounds("startup-1");
    await listCommitments("startup-1", "round-1");

    expect(get).toHaveBeenNthCalledWith(1, "/startups/startup-1/fundraising-rounds", { params: { limit: 100 } });
    expect(get).toHaveBeenNthCalledWith(2, "/startups/startup-1/fundraising-rounds/round-1/commitments", { params: { limit: 100 } });
  });

  it("sends all three coherent commitment ids", async () => {
    await createCommitment("startup-1", {
      investorId: "investor-1",
      pipelineId: "pipeline-1",
      roundId: "round-1",
      amount: 50000,
    });

    expect(post).toHaveBeenCalledWith("/startups/startup-1/commitments", expect.objectContaining({
      investorId: "investor-1",
      pipelineId: "pipeline-1",
      roundId: "round-1",
    }));
  });
});
