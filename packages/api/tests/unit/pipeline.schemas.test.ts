import {
  createPipelineEntrySchema,
  updatePipelineEntrySchema,
  listPipelineQuerySchema,
  pipelineIdParamSchema,
} from "../../src/validators/pipeline.schemas";

const UUID = "00000000-0000-0000-0000-000000000001";
const PIPELINE_ID = "00000000-0000-0000-0000-000000000002";

describe("createPipelineEntrySchema", () => {
  it("accepts a minimal body with investorId and stage", () => {
    const result = createPipelineEntrySchema.safeParse({
      investorId: UUID,
      stage: "sourced",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional expectedAmount and probabilityPercentage", () => {
    const result = createPipelineEntrySchema.safeParse({
      investorId: UUID,
      stage: "meeting_scheduled",
      expectedAmount: 250000.5,
      probabilityPercentage: 60,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expectedAmount).toBe(250000.5);
      expect(result.data.probabilityPercentage).toBe(60);
    }
  });

  it("rejects a missing investorId", () => {
    const result = createPipelineEntrySchema.safeParse({ stage: "sourced" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid investorId", () => {
    const result = createPipelineEntrySchema.safeParse({
      investorId: "not-a-uuid",
      stage: "sourced",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown stage", () => {
    const result = createPipelineEntrySchema.safeParse({
      investorId: UUID,
      stage: "prospect",
    });
    expect(result.success).toBe(false);
  });

  it.each(["committed", "passed"])("rejects terminal initial stage %s", (stage) => {
    expect(createPipelineEntrySchema.safeParse({ investorId: UUID, stage }).success).toBe(false);
  });

  it("rejects probabilityPercentage outside 0–100", () => {
    expect(
      createPipelineEntrySchema.safeParse({
        investorId: UUID,
        stage: "sourced",
        probabilityPercentage: 101,
      }).success,
    ).toBe(false);

    expect(
      createPipelineEntrySchema.safeParse({
        investorId: UUID,
        stage: "sourced",
        probabilityPercentage: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects a non-integer probabilityPercentage", () => {
    const result = createPipelineEntrySchema.safeParse({
      investorId: UUID,
      stage: "sourced",
      probabilityPercentage: 33.3,
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional roundId for an explicitly selected fundraising round", () => {
    const result = createPipelineEntrySchema.safeParse({
      investorId: UUID,
      roundId: "00000000-0000-0000-0000-000000000099",
      stage: "sourced",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative expectedAmount", () => {
    const result = createPipelineEntrySchema.safeParse({
      investorId: UUID,
      stage: "sourced",
      expectedAmount: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("updatePipelineEntrySchema", () => {
  it("accepts a single field update", () => {
    const result = updatePipelineEntrySchema.safeParse({ stage: "term_sheet" });
    expect(result.success).toBe(true);
  });

  it("accepts null to clear expectedAmount and probabilityPercentage", () => {
    const result = updatePipelineEntrySchema.safeParse({
      expectedAmount: null,
      probabilityPercentage: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body", () => {
    const result = updatePipelineEntrySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects an unknown stage", () => {
    const result = updatePipelineEntrySchema.safeParse({ stage: "lead" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative expectedAmount", () => {
    const result = updatePipelineEntrySchema.safeParse({ expectedAmount: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts isLead, so a round can record who is leading it", () => {
    const result = updatePipelineEntrySchema.safeParse({ isLead: true });
    expect(result.success).toBe(true);
  });

  it("accepts commitment details for the move into committed", () => {
    const result = updatePipelineEntrySchema.safeParse({
      stage: "committed",
      commitment: { amount: 250000, status: "hard_circled" },
    });
    expect(result.success).toBe(true);
  });

  // The old vocabulary must not sneak back in through the API.
  it.each(["pending", "negotiating", "confirmed", "funded"])(
    "rejects the retired commitment status %p",
    (status) => {
      const result = updatePipelineEntrySchema.safeParse({
        stage: "committed",
        commitment: { amount: 1000, status },
      });
      expect(result.success).toBe(false);
    },
  );

  it.each(["soft_circled", "hard_circled", "wired", "withdrawn"])(
    "accepts the commitment status %p",
    (status) => {
      const result = updatePipelineEntrySchema.safeParse({
        stage: "committed",
        commitment: { amount: 1000, status },
      });
      expect(result.success).toBe(true);
    },
  );
});

describe("listPipelineQuerySchema", () => {
  it("defaults page and limit", () => {
    const result = listPipelineQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it("coerces page and limit from strings", () => {
    const result = listPipelineQuerySchema.safeParse({ page: "3", limit: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(10);
    }
  });

  it("accepts a valid stage filter", () => {
    const result = listPipelineQuerySchema.safeParse({ stage: "due_diligence" });
    expect(result.success).toBe(true);
  });

  it("accepts a fundraising round filter", () => {
    expect(
      listPipelineQuerySchema.safeParse({ roundId: "00000000-0000-0000-0000-000000000099" })
        .success,
    ).toBe(true);
  });

  it("rejects an unknown stage filter", () => {
    const result = listPipelineQuerySchema.safeParse({ stage: "prospect" });
    expect(result.success).toBe(false);
  });

  it("rejects a limit above 100", () => {
    const result = listPipelineQuerySchema.safeParse({ limit: "101" });
    expect(result.success).toBe(false);
  });
});

describe("pipelineIdParamSchema", () => {
  it("accepts valid UUIDs", () => {
    const result = pipelineIdParamSchema.safeParse({
      startupId: UUID,
      pipelineId: PIPELINE_ID,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing pipelineId", () => {
    const result = pipelineIdParamSchema.safeParse({ startupId: UUID });
    expect(result.success).toBe(false);
  });
});
