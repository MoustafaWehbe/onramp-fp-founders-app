import { hasPermission } from "../middleware/rbac";
import { resolveAiCapabilities } from "../services/ai-capabilities.service";
import { asyncHandler } from "../utils/errors";
import { aiChatService } from "../services/ai-chat.service";
import { aiConversationService } from "../services/ai-conversation.service";
import { aiAnalysisService } from "../services/ai-analysis.service";
import type { CreateAiAnalysisInput, CreateAiMessageInput, CreateAiSessionInput, ListAiAnalysesQuery, ListAiMessagesQuery, ListAiSessionsQuery, UpdateAiSessionInput } from "../validators/ai.schemas";
import type { NextFunction, Request, Response } from "express";

async function accessFor(req: Express.Request) {
  const roleId = req.member!.roleId;
  const grants = (await Promise.all([
    "startup:read", "documents:read", "financial:read", "pipeline:read", "ai_reports:read", "ai_reports:create",
  ].map(async (grant) => { const [resource, action] = grant.split(":"); return (await hasPermission(roleId, resource, action)) ? grant : null; }))).filter((grant): grant is string => Boolean(grant));
  const capabilities = resolveAiCapabilities(grants);
  return { canReadDocuments: grants.includes("documents:read"), canReadFinancial: grants.includes("financial:read"), tools: capabilities.tools };
}

export const aiController = {
  listSessions: asyncHandler(async (req, res) => {
    const sessions = await aiChatService.listSessions(req.params.startupId as string, req.user!.userId, req.query as unknown as ListAiSessionsQuery, await accessFor(req));
    res.json({ data: sessions });
  }),
  getSession: asyncHandler(async (req, res) => {
    const session = await aiChatService.getSession(req.params.startupId as string, req.user!.userId, req.params.sessionId as string, await accessFor(req));
    res.json({ data: session });
  }),
  createSession: asyncHandler(async (req, res) => {
    const session = await aiChatService.createSession(req.params.startupId as string, req.user!.userId, req.body as CreateAiSessionInput, await accessFor(req));
    res.status(201).json({ data: session });
  }),
  updateSession: asyncHandler(async (req, res) => {
    const session = await aiChatService.updateSession(req.params.startupId as string, req.user!.userId, req.params.sessionId as string, req.body as UpdateAiSessionInput, await accessFor(req));
    res.json({ data: session });
  }),
  deleteSession: asyncHandler(async (req, res) => {
    await aiChatService.archiveSession(req.params.startupId as string, req.user!.userId, req.params.sessionId as string);
    res.status(204).send();
  }),
  listMessages: asyncHandler(async (req, res) => {
    const messages = await aiConversationService.listMessages(req.params.startupId as string, req.user!.userId, req.params.sessionId as string, req.query as unknown as ListAiMessagesQuery, await accessFor(req));
    res.json({ data: messages });
  }),
  submitMessage: asyncHandler(async (req, res) => {
    const result = await aiConversationService.submitMessage(req.params.startupId as string, req.user!.userId, req.params.sessionId as string, req.body as CreateAiMessageInput, await accessFor(req));
    res.status(202).json({ data: { ...result, streamUrl: `/api/v1/startups/${req.params.startupId}/ai/sessions/${req.params.sessionId}/messages/${result.assistantMessageId}/stream` } });
  }),
  streamMessage: (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const rawLastEventId = req.header("Last-Event-ID");
      const lastSequence = rawLastEventId && /^\d+$/.test(rawLastEventId) ? Number(rawLastEventId) : 0;
      const { message, replay } = await aiConversationService.openStream(req.params.startupId as string, req.user!.userId, req.params.sessionId as string, req.params.messageId as string, await accessFor(req), lastSequence);
      res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.flushHeaders();
      const send = (event: any) => {
        res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };
      send({ version: 1, sessionId: req.params.sessionId, messageId: req.params.messageId, sequence: 0, timestamp: new Date().toISOString(), type: "stream.ready", payload: {} });
      if (replay.length) replay.forEach(send);
      else send({ version: 1, sessionId: req.params.sessionId, messageId: req.params.messageId, sequence: 0, timestamp: new Date().toISOString(), type: "message.snapshot", payload: { status: message.status, content: message.content } });
      const unsubscribe = aiConversationService.subscribe(req.params.messageId as string, send);
      const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
      const close = () => { clearInterval(heartbeat); unsubscribe(); };
      req.on("close", close);
      res.on("error", close);
    })().catch(next);
  },
  cancelMessage: asyncHandler(async (req, res) => {
    await aiConversationService.cancel(req.params.startupId as string, req.user!.userId, req.params.sessionId as string, req.params.messageId as string);
    res.status(204).send();
  }),
  createAnalysis: asyncHandler(async (req, res) => {
    const analysis = await aiAnalysisService.create(req.params.startupId as string, req.user!.userId, req.body as CreateAiAnalysisInput);
    res.status(202).json({ data: analysis });
  }),
  listAnalyses: asyncHandler(async (req, res) => {
    const analyses = await aiAnalysisService.list(req.params.startupId as string, req.user!.userId, req.query as unknown as ListAiAnalysesQuery);
    res.json({ data: analyses });
  }),
  getAnalysis: asyncHandler(async (req, res) => {
    const analysis = await aiAnalysisService.get(req.params.startupId as string, req.user!.userId, req.params.analysisId as string);
    res.json({ data: analysis });
  }),
  cancelAnalysis: asyncHandler(async (req, res) => {
    await aiAnalysisService.cancel(req.params.startupId as string, req.user!.userId, req.params.analysisId as string);
    res.status(204).send();
  }),
};
