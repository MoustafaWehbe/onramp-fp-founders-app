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
      "get_investor_context",
      "get_reviewer_engagement",
      "search_investors",
      "list_investors",
      "get_pipeline_by_stage",
      "get_interaction_history",
      "list_tasks",
    ]);
    expect(capabilities.tools).not.toContain("get_round_health");
  });

  it("exposes the investor context tool on pipeline:read alone commitment amounts are gated separately inside the tool, not at this layer", () => {
    expect(resolveAiCapabilities(["ai_reports:read", "pipeline:read"]).tools)
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

  it("exposes propose_task_status only with pipeline:update, the same gate the manual task edit endpoint uses", () => {
    expect(resolveAiCapabilities(["ai_reports:read", "pipeline:read"]).tools).not.toContain("propose_task_status");
    expect(resolveAiCapabilities(["ai_reports:read", "pipeline:read", "pipeline:update"]).tools).toContain("propose_task_status");
  });

  it("uses a non-specific response for protected topics", () => {
    expect(AI_UNAVAILABLE_RESOURCE_RESPONSE).not.toMatch(/financial|round|commitment|permission/i);
  });
});
