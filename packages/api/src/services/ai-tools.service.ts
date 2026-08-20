import { z } from "zod";
import { prisma } from "../db/prisma";
import { fundraisingService } from "./fundraising.service";
import { pipelineService } from "./pipeline.service";
import { AI_TOOL_REQUIREMENTS, type AiToolName } from "./ai-capabilities.service";

const toolInputs = {
  get_startup_profile: z.object({}),
  get_round_health: z.object({ roundId: z.string().uuid().optional() }),
  get_pipeline_summary: z.object({ roundId: z.string().uuid().optional() }),
  get_focus_deals: z.object({ roundId: z.string().uuid().optional() }),
  get_investor_context: z.object({ investorId: z.string().uuid() }),
  get_reviewer_engagement: z.object({ documentId: z.string().uuid().optional() }),
} as const;

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

  /** Intent selection is deliberately conservative; it never lets prompt text name an arbitrary tool. */
  selectForPrompt(prompt: string, allowedTools: readonly AiToolName[], roundId?: string | null): Array<{ tool: AiToolName; input: object }> {
    const lower = prompt.toLowerCase();
    const match = (tool: AiToolName, terms: string[]) => allowedTools.includes(tool) && terms.some((term) => lower.includes(term));
    if (match("get_round_health", ["round", "raise", "raised", "commitment", "runway"])) return [{ tool: "get_round_health", input: roundId ? { roundId } : {} }];
    if (match("get_focus_deals", ["attention", "today", "focus", "follow up", "follow-up"])) return [{ tool: "get_focus_deals", input: roundId ? { roundId } : {} }];
    if (match("get_pipeline_summary", ["pipeline", "funnel", "conversion"])) return [{ tool: "get_pipeline_summary", input: roundId ? { roundId } : {} }];
    if (match("get_startup_profile", ["startup", "company profile"])) return [{ tool: "get_startup_profile", input: {} }];
    return [];
  }
}

export const aiToolsService = new AiToolsService();
