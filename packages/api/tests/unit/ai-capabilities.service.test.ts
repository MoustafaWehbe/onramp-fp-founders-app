import {
  AI_UNAVAILABLE_RESOURCE_RESPONSE,
  resolveAiCapabilities,
} from "../../src/services/ai-capabilities.service";

describe("AI capability policy", () => {
  it("does not expose financial tools to a user without financial:read", () => {
    const capabilities = resolveAiCapabilities([
      "ai_reports:read",
      "documents:read",
      "pipeline:read",
    ]);

    expect(capabilities.tools).toEqual([
      "get_pipeline_summary",
      "get_focus_deals",
      "get_reviewer_engagement",
    ]);
    expect(capabilities.tools).not.toContain("get_round_health");
    expect(capabilities.tools).not.toContain("get_investor_context");
  });

  it("requires financial access for investor context because it includes commitments", () => {
    expect(resolveAiCapabilities(["ai_reports:read", "pipeline:read"]).tools)
      .not.toContain("get_investor_context");
    expect(resolveAiCapabilities(["ai_reports:read", "pipeline:read", "financial:read"]).tools)
      .toContain("get_investor_context");
  });

  it("does not expose any application-data tool without AI read access", () => {
    expect(resolveAiCapabilities(["financial:read", "pipeline:read"])).toEqual({
      canReadAi: false,
      canCreateAi: false,
      tools: [],
    });
  });

  it("requires both AI permissions before a user can create a chat or analysis", () => {
    expect(resolveAiCapabilities(["ai_reports:read"]).canCreateAi).toBe(false);
    expect(resolveAiCapabilities(["ai_reports:read", "ai_reports:create"]).canCreateAi).toBe(true);
  });

  it("uses a non-specific response for protected topics", () => {
    expect(AI_UNAVAILABLE_RESOURCE_RESPONSE).not.toMatch(/financial|round|commitment|permission/i);
  });
});
