import {
  createCommitmentSchema,
  createFundraisingRoundSchema,
  updateFundraisingRoundSchema,
} from "../../src/validators/fundraising.schemas";

describe("fundraising schemas", () => {
  it("normalizes a valid currency and rejects invalid financial values", () => {
    expect(
      createFundraisingRoundSchema.parse({
        roundName: "Seed",
        targetAmount: 500000,
        currency: "usd",
      }),
    ).toMatchObject({ currency: "USD" });
    expect(() => createFundraisingRoundSchema.parse({ roundName: "Seed", targetAmount: -1, currency: "USD" })).toThrow();
    expect(() => createFundraisingRoundSchema.parse({ roundName: "Seed", targetAmount: 1, currency: "US" })).toThrow();
    expect(() => updateFundraisingRoundSchema.parse({})).toThrow();
  });

  it("requires a pipeline record for every commitment", () => {
    const input = {
      investorId: "00000000-0000-0000-0000-000000000001",
      roundId: "00000000-0000-0000-0000-000000000002",
      pipelineId: "00000000-0000-0000-0000-000000000003",
      amount: 25000,
    };
    expect(createCommitmentSchema.parse(input)).toMatchObject(input);
    const { pipelineId: _pipelineId, ...withoutPipeline } = input;
    expect(() => createCommitmentSchema.parse(withoutPipeline)).toThrow();
    expect(() => createCommitmentSchema.parse({ ...input, amount: Number.POSITIVE_INFINITY })).toThrow();
  });
});
