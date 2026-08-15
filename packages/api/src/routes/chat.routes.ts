import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireMember, requirePermission } from "../middleware/rbac";
import { validate } from "../utils/validate";
import { startupIdParamSchema } from "../validators/startup.schemas";
import {
  createConversationSchema,
  conversationIdParamSchema,
  sendMessageSchema,
  listMessagesQuerySchema,
} from "../validators/chat.schemas";
import { chatController } from "../controllers/chat.controller";

// Mounted at /api/v1/startups/:startupId/chat — mergeParams keeps :startupId
// visible to the RBAC middleware and the controller, the same pattern every
// other startup-scoped router here uses.
const router = Router({ mergeParams: true });

// POST /api/v1/startups/:startupId/chat/conversations — chat:create
router.post(
  "/conversations",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "create"),
  validate(createConversationSchema),
  chatController.createConversation,
);

// GET /api/v1/startups/:startupId/chat/conversations — chat:read
router.get(
  "/conversations",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "read"),
  chatController.listConversations,
);

// GET /api/v1/startups/:startupId/chat/conversations/:conversationId/messages — chat:read
router.get(
  "/conversations/:conversationId/messages",
  authenticate,
  validate(conversationIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "read"),
  validate(listMessagesQuerySchema, "query"),
  chatController.listMessages,
);

// POST /api/v1/startups/:startupId/chat/conversations/:conversationId/messages — chat:create
router.post(
  "/conversations/:conversationId/messages",
  authenticate,
  validate(conversationIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "create"),
  validate(sendMessageSchema),
  chatController.sendMessage,
);

export { router as chatRouter };
