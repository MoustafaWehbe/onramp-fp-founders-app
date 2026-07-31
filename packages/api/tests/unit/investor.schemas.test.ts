import {
  createInvestorSchema,
  updateInvestorSchema,
  listInvestorsQuerySchema,
  investorIdParamSchema,
} from "../../src/validators/investor.schemas";

const UUID = "00000000-0000-0000-0000-000000000001";

describe("createInvestorSchema", () => {
  it("accepts a minimal body with only fullName", () => {
    const result = createInvestorSchema.safeParse({ fullName: "Ada Lovelace" });
    expect(result.success).toBe(true);
  });

  it("trims and lowercases the email", () => {
    const result = createInvestorSchema.safeParse({
      fullName: "  Ada Lovelace  ",
      email: "  ADA@Example.COM ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fullName).toBe("Ada Lovelace");
      expect(result.data.email).toBe("ada@example.com");
    }
  });

  it("normalizes an empty email to null rather than storing an empty string", () => {
    const result = createInvestorSchema.safeParse({ fullName: "Ada", email: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBeNull();
  });

  it("rejects an invalid email", () => {
    const result = createInvestorSchema.safeParse({ fullName: "Ada", email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a fullName shorter than 2 characters", () => {
    const result = createInvestorSchema.safeParse({ fullName: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects a fullName longer than 150 characters", () => {
    const result = createInvestorSchema.safeParse({ fullName: "a".repeat(151) });
    expect(result.success).toBe(false);
  });

  it("rejects a missing fullName", () => {
    const result = createInvestorSchema.safeParse({ email: "ada@example.com" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid investorType", () => {
    const result = createInvestorSchema.safeParse({ fullName: "Ada", investorType: "family_office" });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown investorType", () => {
    const result = createInvestorSchema.safeParse({ fullName: "Ada", investorType: "hedge_fund" });
    expect(result.success).toBe(false);
  });

  it("accepts an https linkedinUrl", () => {
    const result = createInvestorSchema.safeParse({
      fullName: "Ada",
      linkedinUrl: "https://linkedin.com/in/ada",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a linkedinUrl that is not http or https", () => {
    const result = createInvestorSchema.safeParse({
      fullName: "Ada",
      linkedinUrl: "ftp://linkedin.com/in/ada",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a linkedinUrl with no protocol", () => {
    const result = createInvestorSchema.safeParse({
      fullName: "Ada",
      linkedinUrl: "linkedin.com/in/ada",
    });
    expect(result.success).toBe(false);
  });

  it("rejects notes longer than 2000 characters", () => {
    const result = createInvestorSchema.safeParse({ fullName: "Ada", notes: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });
});

describe("updateInvestorSchema", () => {
  it("accepts a single field", () => {
    const result = updateInvestorSchema.safeParse({ notes: "Following up next week" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body", () => {
    const result = updateInvestorSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts null to clear a nullable field", () => {
    const result = updateInvestorSchema.safeParse({ ventureFirm: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.ventureFirm).toBeNull();
  });

  it("treats an empty string as a clear", () => {
    const result = updateInvestorSchema.safeParse({ ventureFirm: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.ventureFirm).toBeNull();
  });

  it("still validates email format when provided", () => {
    const result = updateInvestorSchema.safeParse({ email: "nope" });
    expect(result.success).toBe(false);
  });
});

describe("listInvestorsQuerySchema", () => {
  it("defaults page and limit when absent", () => {
    const result = listInvestorsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it("coerces numeric strings from the query string", () => {
    const result = listInvestorsQuerySchema.safeParse({ page: "3", limit: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(50);
    }
  });

  it("rejects a limit above 100", () => {
    const result = listInvestorsQuerySchema.safeParse({ limit: "500" });
    expect(result.success).toBe(false);
  });

  it("rejects a page below 1", () => {
    const result = listInvestorsQuerySchema.safeParse({ page: "0" });
    expect(result.success).toBe(false);
  });

  it("treats an empty search as no filter rather than rejecting it", () => {
    const result = listInvestorsQuerySchema.safeParse({ search: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.search).toBeUndefined();
  });

  it("treats a whitespace-only search as no filter", () => {
    const result = listInvestorsQuerySchema.safeParse({ search: "   " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.search).toBeUndefined();
  });

  it("trims a real search term", () => {
    const result = listInvestorsQuerySchema.safeParse({ search: "  accel  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.search).toBe("accel");
  });

  it("rejects an unknown pipeline stage", () => {
    const result = listInvestorsQuerySchema.safeParse({ stage: "nonsense" });
    expect(result.success).toBe(false);
  });

  it("accepts a known pipeline stage", () => {
    const result = listInvestorsQuerySchema.safeParse({ stage: "meeting_scheduled" });
    expect(result.success).toBe(true);
  });
});

describe("investorIdParamSchema", () => {
  it("accepts valid startupId and investorId", () => {
    const result = investorIdParamSchema.safeParse({ startupId: UUID, investorId: UUID });
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID investorId", () => {
    const result = investorIdParamSchema.safeParse({ startupId: UUID, investorId: "nope" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID startupId", () => {
    const result = investorIdParamSchema.safeParse({ startupId: "nope", investorId: UUID });
    expect(result.success).toBe(false);
  });
});
