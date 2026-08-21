import { z } from "zod";
import { prisma } from "../db/prisma";
import { fundraisingService } from "./fundraising.service";
import { pipelineService } from "./pipeline.service";
import type { AiToolName } from "./ai-capabilities.service";
import type { AiToolDefinition } from "./ai-provider.service";

const toolInputs = {
  get_startup_profile: z.object({}),
  get_round_health: z.object({ roundId: z.string().uuid().nullish() }),
  get_pipeline_summary: z.object({ roundId: z.string().uuid().nullish() }),
  get_focus_deals: z.object({ roundId: z.string().uuid().nullish() }),
  get_investor_context: z.object({ investorId: z.string().uuid() }),
  get_reviewer_engagement: z.object({ documentId: z.string().uuid().nullish() }),
} as const;

// The model chooses tools from these definitions. OpenAI's strict function-calling
// mode requires every property to be listed in `required`; a field that's actually
// optional is instead typed to accept null, and the model passes null to omit it.
const ROUND_ID_PROPERTY = { type: ["string", "null"], description: "UUID of the fundraising round, or null to use the currently active round." };
export const AI_TOOL_DEFINITIONS: Record<AiToolName, { description: string; parameters: Record<string, unknown> }> = {
  get_startup_profile: {
    description: "Get this startup's profile: name, description, industry, website, and funding stage.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  get_round_health: {
    description: "Get commitment totals, currency, and metrics for a fundraising round.",
    parameters: { type: "object", properties: { roundId: ROUND_ID_PROPERTY }, required: ["roundId"], additionalProperties: false },
  },
  get_pipeline_summary: {
    description: "Get pipeline analytics: deal counts and conversion by stage for a round.",
    parameters: { type: "object", properties: { roundId: ROUND_ID_PROPERTY }, required: ["roundId"], additionalProperties: false },
  },
  get_focus_deals: {
    description: "Get the deals that most need attention today, ranked by urgency, for a round.",
    parameters: { type: "object", properties: { roundId: ROUND_ID_PROPERTY }, required: ["roundId"], additionalProperties: false },
  },
  get_investor_context: {
    description: "Get full context for one investor: profile, notes, pipeline deals, and recent interaction history. Requires the investor's id — if you only have a name, ask the user for it or check whether the pipeline/focus tools already surfaced the id.",
    parameters: { type: "object", properties: { investorId: { type: "string", description: "UUID of the investor." } }, required: ["investorId"], additionalProperties: false },
  },
  get_reviewer_engagement: {
    description: "Get reviewer invitation counts per document, optionally scoped to one document.",
    parameters: { type: "object", properties: { documentId: { type: ["string", "null"], description: "UUID of the document, or null for all documents." } }, required: ["documentId"], additionalProperties: false },
  },
};

export function toolSchemasFor(allowedTools: readonly AiToolName[]): AiToolDefinition[] {
  return allowedTools.map((tool) => ({ type: "function" as const, name: tool, description: AI_TOOL_DEFINITIONS[tool].description, parameters: AI_TOOL_DEFINITIONS[tool].parameters, strict: true as const }));
}

export class AiToolsService {
  async execute(startupId: string, tool: AiToolName, rawInput: unknown, allowedTools: readonly AiToolName[]) {
    if (!allowedTools.includes(tool)) throw new Error("AI_TOOL_FORBIDDEN");
    const input = toolInputs[tool].parse(rawInput) as any;
    if (tool === "get_startup_profile") return prisma.startup.findUnique({ where: { id: startupId }, select: { name: true, description: true, industry: true, website: true, fundingStage: true } });
    if (tool === "get_round_health") {
      const round = input.roundId
        ? await fundraisingService.getRound(startupId, input.roundId)
        : (await fundraisingService.listRounds(startupId, { page: 1, limit: 1, status: "active" as any })).data[0];
      return round ? { round: { id: round.id, name: round.roundName, currency: round.currency }, metrics: await fundraisingService.getRoundMetrics(startupId, round.id) } : { round: null, metrics: null };
    }
    if (tool === "get_pipeline_summary") return pipelineService.getAnalytics(startupId, input.roundId);
    if (tool === "get_focus_deals") return pipelineService.getFocus(startupId, input.roundId);
    if (tool === "get_investor_context") {
      const investor = await prisma.startupInvestor.findUnique({ where: { startupId_id: { startupId, id: input.investorId } }, select: { id: true, fullName: true, ventureFirm: true, investorType: true, sectorFocus: true, notes: true, pipeline: { take: 10, select: { id: true, roundId: true, stage: true, priority: true, expectedAmount: true } }, interactionLogs: { take: 10, orderBy: { createdAt: "desc" }, select: { type: true, subject: true, interactionDate: true, description: true } } } });
      return investor;
    }
    const versions = await prisma.documentVersion.findMany({ where: { document: { startupId, ...(input.documentId ? { id: input.documentId } : {}) } }, take: 10, select: { id: true, document: { select: { id: true, title: true } } } });
    const counts = await prisma.reviewerInvitationDocument.groupBy({ by: ["documentVersionId"], where: { documentVersionId: { in: versions.map((version) => version.id) } }, _count: { invitationId: true } });
    const countByVersion = new Map(counts.map((count) => [count.documentVersionId, count._count.invitationId]));
    return versions.map((version) => ({ id: version.document.id, title: version.document.title, invitationCount: countByVersion.get(version.id) ?? 0 }));
  }
}

export const aiToolsService = new AiToolsService();
