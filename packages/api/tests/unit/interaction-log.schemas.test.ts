import {
  createInteractionLogSchema,
  updateInteractionLogSchema,
  listInteractionLogQuerySchema,
  logIdParamSchema,
  investorLogParamSchema,
  pipelineLogParamSchema,
} from "../../src/validators/interaction-log.schemas";

describe("createInteractionLogSchema", () => {
  const validBody = {
    investorId: "00000000-0000-0000-0000-000000000001",
    type: "call",
    interactionDate: "2025-01-15T10:00:00.000Z",
  };

  it("accepts a valid body with required fields", () => {
    const result = createInteractionLogSchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = createInteractionLogSchema.safeParse({
      ...validBody,
      pipelineId: "00000000-0000-0000-0000-000000000002",
      subject: "Follow-up call",
      description: "Discussed terms",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing investorId", () => {
    const result = createInteractionLogSchema.safeParse({
      type: "call",
      interactionDate: "2025-01-15T10:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID investorId", () => {
    const result = createInteractionLogSchema.safeParse({
      ...validBody,
      investorId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing type", () => {
    const result = createInteractionLogSchema.safeParse({
      investorId: "00000000-0000-0000-0000-000000000001",
      interactionDate: "2025-01-15T10:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid type", () => {
    const result = createInteractionLogSchema.safeParse({
      ...validBody,
      type: "invalid_type",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing interactionDate", () => {
    const result = createInteractionLogSchema.safeParse({
      investorId: "00000000-0000-0000-0000-000000000001",
      type: "call",
    });
    expect(result.success).toBe(false);
  });

  it.each([null, false, 0, ""])(
    "rejects %p for interactionDate instead of coercing it to the 1970 epoch",
    (value) => {
      const result = createInteractionLogSchema.safeParse({
        ...validBody,
        interactionDate: value,
      });
      expect(result.success).toBe(false);
    },
  );

  // Tasks superseded follow-ups. The columns and their existing rows survive
  // as read-only history, but nothing may write a new one, so the field is
  // dropped rather than persisted.
  it("ignores a nextFollowupDate instead of writing one", () => {
    const result = createInteractionLogSchema.safeParse({
      ...validBody,
      nextFollowupDate: "2026-02-01T10:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("nextFollowupDate");
    }
  });

  it("accepts all valid interaction types", () => {
    for (const type of ["call", "email", "meeting", "note", "other"]) {
      const result = createInteractionLogSchema.safeParse({ ...validBody, type });
      expect(result.success).toBe(true);
    }
  });
});

describe("updateInteractionLogSchema", () => {
  it("accepts a partial update", () => {
    const result = updateInteractionLogSchema.safeParse({ type: "meeting" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body", () => {
    const result = updateInteractionLogSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts null for pipelineId to clear it", () => {
    const result = updateInteractionLogSchema.safeParse({ pipelineId: null });
    expect(result.success).toBe(true);
  });

  it("ignores follow-up fields rather than writing them", () => {
    const result = updateInteractionLogSchema.safeParse({
      subject: "Updated",
      nextFollowupDate: "2026-02-01T10:00:00.000Z",
      followupCompletedAt: "2026-02-02T10:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("nextFollowupDate");
      expect(result.data).not.toHaveProperty("followupCompletedAt");
    }
  });

  it("accepts null for interactionDate to clear it, not the 1970 epoch", () => {
    const result = updateInteractionLogSchema.safeParse({ interactionDate: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interactionDate).toBeNull();
    }
  });

  it.each([false, 0, ""])(
    "rejects %p for interactionDate instead of coercing it to the 1970 epoch",
    (value) => {
      const result = updateInteractionLogSchema.safeParse({ interactionDate: value });
      expect(result.success).toBe(false);
    },
  );

  it("rejects an invalid type", () => {
    const result = updateInteractionLogSchema.safeParse({ type: "invalid" });
    expect(result.success).toBe(false);
  });
});

describe("listInteractionLogQuerySchema", () => {
  it("applies defaults for page and limit", () => {
    const result = listInteractionLogQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it("rejects a page less than 1", () => {
    const result = listInteractionLogQuerySchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a limit greater than 100", () => {
    const result = listInteractionLogQuerySchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });
});

describe("logIdParamSchema", () => {
  it("accepts valid UUIDs", () => {
    const result = logIdParamSchema.safeParse({
      startupId: "00000000-0000-0000-0000-000000000001",
      logId: "00000000-0000-0000-0000-000000000002",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID logId", () => {
    const result = logIdParamSchema.safeParse({
      startupId: "00000000-0000-0000-0000-000000000001",
      logId: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

describe("investorLogParamSchema", () => {
  it("accepts valid UUIDs", () => {
    const result = investorLogParamSchema.safeParse({
      startupId: "00000000-0000-0000-0000-000000000001",
      investorId: "00000000-0000-0000-0000-000000000002",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing params", () => {
    const result = investorLogParamSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("pipelineLogParamSchema", () => {
  it("accepts valid UUIDs", () => {
    const result = pipelineLogParamSchema.safeParse({
      startupId: "00000000-0000-0000-0000-000000000001",
      pipelineId: "00000000-0000-0000-0000-000000000002",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing params", () => {
    const result = pipelineLogParamSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});