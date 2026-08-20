import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { aiController } from "../controllers/ai.controller";
import { requireAiEnabled } from "../middleware/ai-enabled";
import { aiMessageRateLimiter } from "../middleware/rate-limiter";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import { aiAnalysisIdParamSchema, aiMessageStreamParamSchema, aiSessionIdParamSchema, createAiAnalysisSchema, createAiMessageSchema, createAiSessionSchema, listAiAnalysesQuerySchema, listAiMessagesQuerySchema, listAiSessionsQuerySchema, updateAiSessionSchema } from "../validators/ai.schemas";

const router = Router({ mergeParams: true });
const aiRead = [authenticate, validate(startupIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "read")] as const;

router.get("/sessions", ...aiRead, validate(listAiSessionsQuerySchema, "query"), aiController.listSessions);
router.post("/sessions", authenticate, validate(startupIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "create"), requireAiEnabled, validate(createAiSessionSchema), aiController.createSession);
router.get("/sessions/:sessionId", authenticate, validate(aiSessionIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "read"), aiController.getSession);
router.patch("/sessions/:sessionId", authenticate, validate(aiSessionIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "read"), validate(updateAiSessionSchema), aiController.updateSession);
router.delete("/sessions/:sessionId", authenticate, validate(aiSessionIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "read"), aiController.deleteSession);
router.get("/sessions/:sessionId/messages", authenticate, validate(aiSessionIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "read"), validate(listAiMessagesQuerySchema, "query"), aiController.listMessages);
router.post("/sessions/:sessionId/messages", authenticate, validate(aiSessionIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "create"), requireAiEnabled, aiMessageRateLimiter, validate(createAiMessageSchema), aiController.submitMessage);
router.get("/sessions/:sessionId/messages/:messageId/stream", authenticate, validate(aiMessageStreamParamSchema, "params"), requireMember, requirePermission("ai_reports", "read"), requireAiEnabled, aiController.streamMessage);
router.post("/sessions/:sessionId/messages/:messageId/cancel", authenticate, validate(aiMessageStreamParamSchema, "params"), requireMember, requirePermission("ai_reports", "create"), aiController.cancelMessage);
router.get("/analyses", ...aiRead, validate(listAiAnalysesQuerySchema, "query"), aiController.listAnalyses);
router.post("/analyses", authenticate, validate(startupIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "create"), requirePermission("documents", "read"), requireAiEnabled, validate(createAiAnalysisSchema), aiController.createAnalysis);
router.get("/analyses/:analysisId", authenticate, validate(aiAnalysisIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "read"), requirePermission("documents", "read"), aiController.getAnalysis);
router.post("/analyses/:analysisId/cancel", authenticate, validate(aiAnalysisIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "create"), requirePermission("documents", "read"), aiController.cancelAnalysis);

export { router as aiRouter };
