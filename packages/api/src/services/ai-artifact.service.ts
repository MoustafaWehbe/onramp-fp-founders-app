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

export const AI_ARTIFACT_REGISTRY = {
  "source_answer.v1": { schema: sourceAnswerSchema, requiredPermissions: ["documents:read"] },
  "comparison.v1": { schema: comparisonSchema, requiredPermissions: ["documents:read"] },
  "email_draft.v1": { schema: emailDraftSchema, requiredPermissions: [] },
  "meeting_brief.v1": { schema: meetingBriefSchema, requiredPermissions: [] },
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
