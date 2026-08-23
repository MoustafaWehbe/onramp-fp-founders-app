/**
 * Server-owned AI capability policy. The provider only receives tools returned
 * here; it never receives an unrestricted database capability or permission
 * rules it can bypass.
 */
export const AI_TOOL_REQUIREMENTS = {
  get_startup_profile: ["startup:read"],
  get_round_health: ["financial:read"],
  forecast_round_close: ["financial:read", "pipeline:read"],
  get_pipeline_summary: ["pipeline:read"],
  get_focus_deals: ["pipeline:read"],
  get_daily_briefing: ["pipeline:read"],
  // Commitment amounts are added on top of this base profile only when the
  // caller also has financial:read (see ai-tools.service.ts) — pipeline access
  // alone is enough for the profile, notes, deal stage, and interaction history.
  get_investor_context: ["pipeline:read"],
  get_reviewer_engagement: ["documents:read"],
  search_investors: ["pipeline:read"],
  list_investors: ["pipeline:read"],
  get_pipeline_by_stage: ["pipeline:read"],
  get_interaction_history: ["pipeline:read"],
  list_tasks: ["pipeline:read"],
  list_team_conversations: ["chat:read"],
  search_team_messages: ["chat:read"],
  // Propose-only: these never send/schedule/write anything themselves, they
  // create a row a human must click Send on so the gate here mirrors the
  // manual endpoint's own requirement, not a lighter one.
  propose_task: ["pipeline:create"],
  propose_interaction_log: ["pipeline:create"],
  propose_meeting: ["pipeline:create"],
  propose_investor_email: ["pipeline:create"],
  propose_stage_change: ["pipeline:update"],
  propose_task_status: ["pipeline:update"],
} as const;

export type AiToolName = keyof typeof AI_TOOL_REQUIREMENTS;

export interface AiCapabilities {
  canReadAi: boolean;
  canCreateAi: boolean;
  tools: AiToolName[];
}

/**
 * Produces the allowlist for one request from permissions already loaded for
 * the caller's active startup role. A missing underlying permission removes
 * the capability completely, preventing both tool calls and prompt context.
 */
export function resolveAiCapabilities(grants: Iterable<string>): AiCapabilities {
  const permissions = new Set(grants);
  const canReadAi = permissions.has("ai_reports:read");
  const canCreateAi = canReadAi && permissions.has("ai_reports:create");

  if (!canReadAi) {
    return { canReadAi, canCreateAi, tools: [] };
  }

  const tools = (Object.entries(AI_TOOL_REQUIREMENTS) as [AiToolName, readonly string[]][])
    .filter(([, requirements]) => requirements.every((permission) => permissions.has(permission)))
    .map(([toolName]) => toolName);

  return { canReadAi, canCreateAi, tools };
}

/** A non-specific refusal avoids disclosing protected records or role grants. */
export const AI_UNAVAILABLE_RESOURCE_RESPONSE = "I can’t help with that request.";
