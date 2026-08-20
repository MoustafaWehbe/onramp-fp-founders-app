import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import type { CreateAiSessionInput, ListAiSessionsQuery, UpdateAiSessionInput } from "../validators/ai.schemas";

export interface AiSessionAccess {
  canReadDocuments: boolean;
  canReadFinancial: boolean;
}

function serializeSession(session: any, access: AiSessionAccess) {
  return {
    id: session.id,
    startupId: session.startupId,
    title: session.title,
    contextMode: session.contextMode,
    lastMessageAt: session.lastMessageAt,
    archivedAt: session.archivedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(access.canReadFinancial ? { roundId: session.roundId } : {}),
    ...(access.canReadDocuments ? {
      documents: session.documents.map((item: any) => ({
        documentId: item.documentId,
        documentVersionId: item.documentVersionId,
        title: item.document.title,
        versionNumber: item.documentVersion.versionNumber,
        processingStatus: item.documentVersion.processingStatus,
      })),
      persona: session.persona ? { id: session.persona.id, name: session.persona.personaName, description: session.persona.description } : null,
    } : {}),
  };
}

export class AiChatService {
  async listSessions(startupId: string, userId: string, query: ListAiSessionsQuery, access: AiSessionAccess) {
    const sessions = await prisma.aiChatSession.findMany({
      where: { startupId, userId, ...(query.archived ? { archivedAt: { not: null } } : { archivedAt: null }) },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      take: query.limit,
      include: access.canReadDocuments ? {
        documents: { include: { document: { select: { title: true } }, documentVersion: { select: { versionNumber: true, processingStatus: true } } } }, persona: { select: { id: true, personaName: true, description: true } },
      } : undefined,
    });
    return sessions.map((session) => serializeSession({ ...session, documents: "documents" in session ? session.documents : [] }, access));
  }

  async getSession(startupId: string, userId: string, sessionId: string, access: AiSessionAccess) {
    const session = await prisma.aiChatSession.findFirst({
      where: { id: sessionId, startupId, userId },
      include: access.canReadDocuments ? {
        documents: { include: { document: { select: { title: true } }, documentVersion: { select: { versionNumber: true, processingStatus: true } } } }, persona: { select: { id: true, personaName: true, description: true } },
      } : undefined,
    });
    if (!session) throw createError("AI session not found", 404, "AI_SESSION_NOT_FOUND");
    return serializeSession({ ...session, documents: "documents" in session ? session.documents : [] }, access);
  }

  async createSession(startupId: string, userId: string, input: CreateAiSessionInput, access: AiSessionAccess) {
    const versionIds = [...new Set(input.documentVersionIds)];
    if (versionIds.length && !access.canReadDocuments) throw createError("Forbidden", 403, "FORBIDDEN");
    if (input.roundId && !access.canReadFinancial) throw createError("Forbidden", 403, "FORBIDDEN");

    if (input.roundId) {
      const round = await prisma.fundraisingRound.findUnique({ where: { startupId_id: { startupId, id: input.roundId } }, select: { id: true } });
      if (!round) throw createError("Round not found", 404, "ROUND_NOT_FOUND");
    }

    if (versionIds.length) {
      const versions = await prisma.documentVersion.findMany({
        where: { id: { in: versionIds }, processingStatus: "ready", document: { startupId } },
        select: { id: true, documentId: true },
      });
      if (versions.length !== versionIds.length) throw createError("One or more document versions are unavailable", 400, "AI_INVALID_DOCUMENT_VERSION");
      return this.persistSession(startupId, userId, input, versions.map((version) => ({ documentId: version.documentId, documentVersionId: version.id })), access);
    }

    return this.persistSession(startupId, userId, input, [], access);
  }

  async updateSession(startupId: string, userId: string, sessionId: string, input: UpdateAiSessionInput, access: AiSessionAccess) {
    await this.assertOwned(startupId, userId, sessionId);
    if (input.personaId !== undefined && input.personaId !== null) {
      if (!access.canReadDocuments) throw createError("Forbidden", 403, "FORBIDDEN");
      const persona = await prisma.investorPersona.findFirst({ where: { id: input.personaId, analysis: { startupId } }, select: { id: true } });
      if (!persona) throw createError("Investor persona not found", 404, "AI_PERSONA_NOT_FOUND");
    }
    const session = await prisma.aiChatSession.update({
      where: { id: sessionId },
      data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}), ...(input.personaId !== undefined ? { personaId: input.personaId } : {}) },
      include: access.canReadDocuments ? { persona: { select: { id: true, personaName: true, description: true } } } : undefined,
    });
    return serializeSession({ ...session, documents: [], persona: "persona" in session ? session.persona : null }, access);
  }

  async archiveSession(startupId: string, userId: string, sessionId: string): Promise<void> {
    await this.assertOwned(startupId, userId, sessionId);
    await prisma.aiChatSession.update({ where: { id: sessionId }, data: { archivedAt: new Date() } });
  }

  private async persistSession(startupId: string, userId: string, input: CreateAiSessionInput, documents: Array<{ documentId: string; documentVersionId: string }>, access: AiSessionAccess) {
    const session = await prisma.aiChatSession.create({
      data: {
        startupId, userId, title: input.title, contextMode: input.contextMode,
        ...(input.roundId ? { roundId: input.roundId } : {}),
        documents: documents.length ? { create: documents } : undefined,
      },
      include: { documents: { include: { document: { select: { title: true } }, documentVersion: { select: { versionNumber: true, processingStatus: true } } } }, persona: { select: { id: true, personaName: true, description: true } } },
    });
    return serializeSession(session, access);
  }

  private async assertOwned(startupId: string, userId: string, sessionId: string): Promise<void> {
    const session = await prisma.aiChatSession.findFirst({ where: { id: sessionId, startupId, userId }, select: { id: true } });
    if (!session) throw createError("AI session not found", 404, "AI_SESSION_NOT_FOUND");
  }
}

export const aiChatService = new AiChatService();
