import { RESOURCE_META, type ResourceName } from "../config/permissions";

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

/**
 * The data areas the copilot can and cannot reach for this caller.
 *
 * Removing a tool stops the copilot *reading* protected data, but on its own
 * it leaves the model with no idea why it came up empty — so it guesses,
 * asks the founder to paste the data, or apologizes vaguely. Naming the gap
 * lets it say the true thing instead: this is a permission you don't have,
 * here is what it's called, ask an owner for it.
 *
 * Only the caller's *own* grants are described. That tells them nothing about
 * other members' access or about which records exist, so it discloses
 * strictly less than the Team & Roles page they can already open.
 */
const AI_READ_DOMAINS = [
  { permission: "pipeline:read", resource: "pipeline" },
  { permission: "financial:read", resource: "financial" },
  { permission: "documents:read", resource: "documents" },
  { permission: "chat:read", resource: "chat" },
  { permission: "startup:read", resource: "startup" },
] as const satisfies readonly { permission: string; resource: ResourceName }[];

export interface AiAccessDomain {
  /** The grant that unlocks it, exactly as the role editor names it. */
  permission: string;
  /** e.g. "Investors & pipeline" — the Team & Roles page label. */
  label: string;
  /** What a founder would call the subject matter behind it. */
  topics: string;
}

export interface AiAccessSummary {
  available: AiAccessDomain[];
  denied: AiAccessDomain[];
}

export function describeAiAccess(grants: Iterable<string>): AiAccessSummary {
  const permissions = new Set(grants);
  const summary: AiAccessSummary = { available: [], denied: [] };

  for (const domain of AI_READ_DOMAINS) {
    const meta = RESOURCE_META[domain.resource];
    const entry = { permission: domain.permission, label: meta.label, topics: meta.topics };
    (permissions.has(domain.permission) ? summary.available : summary.denied).push(entry);
  }

  return summary;
}

/**
 * The instruction block that turns a missing tool into an honest answer.
 * Empty when the caller can read everything — there is nothing to disclaim,
 * and an empty string drops out of the prompt join.
 */
export function aiAccessInstructions(summary: AiAccessSummary): string {
  if (summary.denied.length === 0) return "";

  const denied = summary.denied
    .map((domain) => `- ${domain.topics} — requires the "${domain.label}: View" permission`)
    .join("\n");

  return [
    "This user's workspace role does not grant access to the following, so you have no tools for them and no data about them in this conversation:",
    denied,
    "If the user asks about anything in that list, do not guess, do not answer from general knowledge, and do not ask them to paste the data in. Say plainly and in one or two sentences that they don't have access to it in this workspace, name the permission above that would grant it, and tell them a workspace owner or admin can enable it on the Team & Roles page. Then offer what you *can* help with from the areas they do have access to. Never imply the data doesn't exist, never speculate about what it might contain, and never state or guess numbers, names, or records from a restricted area.",
  ].join("\n");
}
