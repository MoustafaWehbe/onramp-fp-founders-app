import { z } from "zod";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";

const sourceAnswerSchema = z.object({
  answer: z.string().min(1).max(20_000),
  sources: z.array(z.object({ label: z.string().min(1).max(300), excerpt: z.string().max(1_500).nullable() })).max(20),
});
const comparisonSchema = z.object({
  title: z.string().min(1).max(160),
  fields: z.array(z.object({ label: z.string().min(1).max(120), left: z.string().max(2_000), right: z.string().max(2_000), changed: z.boolean() })).min(1).max(30),
});
const emailDraftSchema = z.object({ subject: z.string().min(1).max(240), body: z.string().min(1).max(20_000), contextLabel: z.string().min(1).max(300), missingInvestorContext: z.boolean() });
const meetingBriefSchema = z.object({ title: z.string().min(1).max(240), talkingPoints: z.array(z.string().min(1).max(1_000)).min(1).max(10), contextLabel: z.string().min(1).max(300), missingInvestorContext: z.boolean() });
const actionProposalSchema = z.object({
  actionId: z.string().uuid(),
  actionType: z.enum(["create_task", "log_interaction", "schedule_meeting", "send_investor_email", "update_deal_stage", "update_task_status"]),
  status: z.enum(["proposed", "approved", "executed", "rejected", "failed", "expired"]),
  payload: z.record(z.unknown()),
  expiresAt: z.string(),
});
const investorBriefSchema = z.object({
  investorId: z.string().uuid(),
  fullName: z.string().min(1).max(200),
  ventureFirm: z.string().max(200).nullable(),
  investorType: z.string().max(50).nullable(),
  sectorFocus: z.string().max(200).nullable(),
  description: z.string().max(2000).nullable(),
  checkSizeMin: z.number().nullable(),
  checkSizeMax: z.number().nullable(),
  stage: z.string().nullable(),
  daysInStage: z.number().int().nullable(),
  lastInteractions: z.array(z.object({ type: z.string(), subject: z.string().nullable(), interactionDate: z.string().nullable() })).max(5),
});
const focusListSchema = z.object({
  roundId: z.string().uuid().nullable(),
  deals: z
    .array(
      z.object({
        investorId: z.string(),
        investorName: z.string(),
        stage: z.string(),
        reason: z.enum(["overdue", "today", "missing", "quiet", "priority"]),
        daysQuiet: z.number().int(),
        nextTaskDueDate: z.string().nullable(),
      }),
    )
    .max(15),
});
const pipelineBoardSchema = z.object({
  stages: z.array(z.object({ stage: z.string(), count: z.number().int(), totalValue: z.number() })).max(10),
});
const taskListSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        priority: z.string(),
        dueDate: z.string().nullable(),
        assigned: z.boolean(),
      }),
    )
    .max(20),
});
const forecastSchema = z.object({
  roundName: z.string().min(1).max(200),
  currency: z.string().min(1).max(10),
  targetAmount: z.number().nonnegative(),
  committedToDate: z.number().nonnegative(),
  softPipeline: z.number().nonnegative(),
  projectedDaysToClose: z.number().int().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  insufficientData: z.boolean(),
  inputs: z.object({
    windowDays: z.number().int(),
    stageEventCount: z.number().int(),
    overallConversionRate: z.number().nullable(),
    cycleTimeDays: z.number().nullable(),
    newDealsPerDay: z.number(),
    averageCheckSize: z.number().nullable(),
  }),
});

export const AI_ARTIFACT_REGISTRY = {
  "source_answer.v1": { schema: sourceAnswerSchema, requiredPermissions: ["documents:read"] },
  "comparison.v1": { schema: comparisonSchema, requiredPermissions: ["documents:read"] },
  "email_draft.v1": { schema: emailDraftSchema, requiredPermissions: [] },
  "meeting_brief.v1": { schema: meetingBriefSchema, requiredPermissions: [] },
  "forecast.v1": { schema: forecastSchema, requiredPermissions: ["financial:read"] },
  // No extra gate here beyond what already produced it: the tool call that
  // created this proposal already required pipeline:create/update, and the
  // approve endpoint re-checks live permission again before executing it.
  "action_proposal.v1": { schema: actionProposalSchema, requiredPermissions: [] },
  // Same reasoning as action_proposal.v1: these only ever get created after
  // the read tool that supplied their data already ran, which is the real gate.
  "investor_brief.v1": { schema: investorBriefSchema, requiredPermissions: [] },
  "focus_list.v1": { schema: focusListSchema, requiredPermissions: [] },
  "pipeline_board.v1": { schema: pipelineBoardSchema, requiredPermissions: [] },
  "task_list.v1": { schema: taskListSchema, requiredPermissions: [] },
} as const;

export type AiArtifactType = keyof typeof AI_ARTIFACT_REGISTRY;

export function allowedArtifactTypes(grants: Iterable<string>): AiArtifactType[] {
  const permissionSet = new Set(grants);
  return (Object.entries(AI_ARTIFACT_REGISTRY) as [AiArtifactType, { requiredPermissions: readonly string[] }][])
    .filter(([, definition]) => definition.requiredPermissions.every((permission) => permissionSet.has(permission)))
    .map(([type]) => type);
}

export function aiCapabilityManifest(grants: Iterable<string>, context: { hasPinnedDocuments: boolean; hasRound: boolean }) {
  return {
    artifactTypes: allowedArtifactTypes(grants).filter((type) => type !== "source_answer.v1" || context.hasPinnedDocuments),
    context: { hasPinnedDocuments: context.hasPinnedDocuments, hasRound: context.hasRound },
    // There are no artifact actions in this release. Keeping the array explicit
    // prevents a model payload from creating an action by convention.
    actionIds: [] as string[],
  };
}

export class AiArtifactService {
  async createReady(input: { startupId: string; sessionId: string; messageId: string; type: AiArtifactType; title?: string; data: unknown }) {
    const definition = AI_ARTIFACT_REGISTRY[input.type];
    const parsed = definition.schema.safeParse(input.data);
    if (!parsed.success) throw createError("Invalid AI artifact", 400, "AI_INVALID_ARTIFACT");
    const [artifactType, schemaVersion] = input.type.split(".");
    return prisma.aiArtifact.create({
      data: { startupId: input.startupId, sessionId: input.sessionId, messageId: input.messageId, artifactType, schemaVersion, title: input.title, status: "ready", data: parsed.data as object },
    });
  }
}

export const aiArtifactService = new AiArtifactService();
