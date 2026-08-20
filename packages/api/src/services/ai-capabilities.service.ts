/**
 * Server-owned AI capability policy. The provider only receives tools returned
 * here; it never receives an unrestricted database capability or permission
 * rules it can bypass.
 */
export const AI_TOOL_REQUIREMENTS = {
  get_startup_profile: ["startup:read"],
  get_round_health: ["financial:read"],
  get_pipeline_summary: ["pipeline:read"],
  get_focus_deals: ["pipeline:read"],
  // This combined tool includes commitments, so pipeline access alone is not
  // enough. A future non-financial investor tool can be introduced separately.
  get_investor_context: ["pipeline:read", "financial:read"],
  get_reviewer_engagement: ["documents:read"],
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
