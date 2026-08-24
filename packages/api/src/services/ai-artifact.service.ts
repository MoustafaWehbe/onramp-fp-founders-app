import { z } from "zod";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";

const actionProposalSchema = z.object({
  actionId: z.string().guid(),
  actionType: z.enum(["create_task", "log_interaction", "schedule_meeting", "send_investor_email", "update_deal_stage", "update_task_status"]),
  status: z.enum(["proposed", "approved", "executed", "rejected", "failed", "expired"]),
  payload: z.record(z.string(), z.unknown()),
  expiresAt: z.string(),
});

export const AI_ARTIFACT_REGISTRY = {
  // The only artifact type left: a propose_* tool's result requires a human to
  // review and click Approve/Discard before anything actually happens, so this
  // is the one card that isn't decorative. No extra permission gate beyond what
  // already produced it — the tool call that created this proposal already
  // required pipeline:create/update, and the approve endpoint re-checks live
  // permission again before executing it.
  "action_proposal.v1": { schema: actionProposalSchema, requiredPermissions: [] },
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
    artifactTypes: allowedArtifactTypes(grants),
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
