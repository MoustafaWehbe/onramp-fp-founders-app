import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { aiController } from "../controllers/ai.controller";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import { aiMessageStreamParamSchema, aiSessionIdParamSchema, createAiMessageSchema, createAiSessionSchema, listAiSessionsQuerySchema, updateAiSessionSchema } from "../validators/ai.schemas";

const router = Router({ mergeParams: true });
const aiRead = [authenticate, validate(startupIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "read")] as const;

router.get("/sessions", ...aiRead, validate(listAiSessionsQuerySchema, "query"), aiController.listSessions);
router.post("/sessions", authenticate, validate(startupIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "create"), validate(createAiSessionSchema), aiController.createSession);
router.get("/sessions/:sessionId", authenticate, validate(aiSessionIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "read"), aiController.getSession);
router.patch("/sessions/:sessionId", authenticate, validate(aiSessionIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "read"), validate(updateAiSessionSchema), aiController.updateSession);
router.delete("/sessions/:sessionId", authenticate, validate(aiSessionIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "read"), aiController.deleteSession);
router.post("/sessions/:sessionId/messages", authenticate, validate(aiSessionIdParamSchema, "params"), requireMember, requirePermission("ai_reports", "create"), validate(createAiMessageSchema), aiController.submitMessage);
router.get("/sessions/:sessionId/messages/:messageId/stream", authenticate, validate(aiMessageStreamParamSchema, "params"), requireMember, requirePermission("ai_reports", "read"), aiController.streamMessage);
router.post("/sessions/:sessionId/messages/:messageId/cancel", authenticate, validate(aiMessageStreamParamSchema, "params"), requireMember, requirePermission("ai_reports", "create"), aiController.cancelMessage);

export { router as aiRouter };
