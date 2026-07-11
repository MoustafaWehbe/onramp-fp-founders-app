import { createStartupSchema } from "../../src/validators/startup.schemas";

const VALID_INPUT = {
  name: "Acme Corp",
  description: "An AI-powered fundraising platform.",
  industry: "SaaS",
  website: "https://acmecorp.com",
  funding_stage: "pre_seed" as const,
};

describe("createStartupSchema", () => {
  it("accepts a fully valid payload", () => {
    const result = createStartupSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  // ─── name ────────────────────────────────────────────────────────────────────

  it("rejects when name is missing", () => {
    const { name: _, ...rest } = VALID_INPUT;
    const result = createStartupSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when name is empty string", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects when name exceeds 100 characters", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  // ─── description ─────────────────────────────────────────────────────────────

  it("rejects when description is missing", () => {
    const { description: _, ...rest } = VALID_INPUT;
    const result = createStartupSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when description is empty string", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, description: "" });
    expect(result.success).toBe(false);
  });

  it("rejects when description exceeds 500 characters", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, description: "a".repeat(501) });
    expect(result.success).toBe(false);
  });

  // ─── industry ────────────────────────────────────────────────────────────────

  it("rejects when industry is missing", () => {
    const { industry: _, ...rest } = VALID_INPUT;
    const result = createStartupSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when industry is empty string", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, industry: "" });
    expect(result.success).toBe(false);
  });

  it("rejects when industry exceeds 100 characters", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, industry: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  // ─── website ─────────────────────────────────────────────────────────────────

  it("rejects when website is missing", () => {
    const { website: _, ...rest } = VALID_INPUT;
    const result = createStartupSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when website is empty string", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, website: "" });
    expect(result.success).toBe(false);
  });

  it("rejects when website is not a valid URL", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, website: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects when website has no protocol", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, website: "acmecorp.com" });
    expect(result.success).toBe(false);
  });

  it("accepts https website", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, website: "https://acmecorp.com" });
    expect(result.success).toBe(true);
  });

  it("accepts http website", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, website: "http://localhost:3000" });
    expect(result.success).toBe(true);
  });

  // ─── funding_stage ───────────────────────────────────────────────────────────

  it("rejects when funding_stage is missing", () => {
    const { funding_stage: _, ...rest } = VALID_INPUT;
    const result = createStartupSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid funding_stage value", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, funding_stage: "round_a" });
    expect(result.success).toBe(false);
  });

  it.each(["pre_seed", "seed", "series_a", "series_b", "series_c"])(
    "accepts funding_stage '%s'",
    (stage) => {
      const result = createStartupSchema.safeParse({ ...VALID_INPUT, funding_stage: stage });
      expect(result.success).toBe(true);
    },
  );

  // ─── trimming ────────────────────────────────────────────────────────────────

  it("trims whitespace from name", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, name: "  Acme  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Acme");
  });

  it("trims whitespace from description", () => {
    const result = createStartupSchema.safeParse({ ...VALID_INPUT, description: "  hello  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBe("hello");
  });
});
