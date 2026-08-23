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
  mentionableQuerySchema,
  resolveMentionsSchema,
  mentionsBacklinkQuerySchema,
  messageIdParamSchema,
  repliesQuerySchema,
  reactionIdParamSchema,
  toggleReactionSchema,
  notifyLevelSchema,
  startDirectMessageSchema,
  archiveConversationSchema,
  listConversationsQuerySchema,
} from "../validators/chat.schemas";
import { chatController } from "../controllers/chat.controller";

// Mounted at /api/v1/startups/:startupId/chat mergeParams keeps :startupId
// visible to the RBAC middleware and the controller, the same pattern every
// other startup-scoped router here uses.
const router = Router({ mergeParams: true });

// POST /api/v1/startups/:startupId/chat/conversations chat:create
router.post(
  "/conversations",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "create"),
  validate(createConversationSchema),
  chatController.createConversation,
);

// POST /api/v1/startups/:startupId/chat/dm chat:create
// Finds or creates the 1:1 DM with another active member see
// ChatService.startDirectMessage for the dmKey dedup logic.
router.post(
  "/dm",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "create"),
  validate(startDirectMessageSchema),
  chatController.startDirectMessage,
);

// GET /api/v1/startups/:startupId/chat/conversations chat:read
router.get(
  "/conversations",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "read"),
  validate(listConversationsQuerySchema, "query"),
  chatController.listConversations,
);

// GET /api/v1/startups/:startupId/chat/conversations/:conversationId/messages chat:read
router.get(
  "/conversations/:conversationId/messages",
  authenticate,
  validate(conversationIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "read"),
  validate(listMessagesQuerySchema, "query"),
  chatController.listMessages,
);

// POST /api/v1/startups/:startupId/chat/conversations/:conversationId/messages chat:create
router.post(
  "/conversations/:conversationId/messages",
  authenticate,
  validate(conversationIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "create"),
  validate(sendMessageSchema),
  chatController.sendMessage,
);

// GET /api/v1/startups/:startupId/chat/conversations/:conversationId/messages/:messageId/replies chat:read
router.get(
  "/conversations/:conversationId/messages/:messageId/replies",
  authenticate,
  validate(messageIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "read"),
  validate(repliesQuerySchema, "query"),
  chatController.listReplies,
);

// POST /api/v1/startups/:startupId/chat/conversations/:conversationId/read chat:read
// Marks the caller caught up through the latest top-level message.
router.post(
  "/conversations/:conversationId/read",
  authenticate,
  validate(conversationIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "read"),
  chatController.markRead,
);

// PATCH /api/v1/startups/:startupId/chat/conversations/:conversationId/notify-level chat:read
// Muting your own view of a room only needs read access, not create.
router.patch(
  "/conversations/:conversationId/notify-level",
  authenticate,
  validate(conversationIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "read"),
  validate(notifyLevelSchema),
  chatController.setNotifyLevel,
);

// PATCH /api/v1/startups/:startupId/chat/conversations/:conversationId/archived chat:manage
// Archiving is a moderation action on a shared room, gated by chat:manage
// rather than mere membership. Rejects DMs inside the service.
router.patch(
  "/conversations/:conversationId/archived",
  authenticate,
  validate(conversationIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "manage"),
  validate(archiveConversationSchema),
  chatController.setConversationArchived,
);

// POST /api/v1/startups/:startupId/chat/conversations/:conversationId/typing chat:create
// Fire-and-forget presence ping, gated the same as actually posting.
router.post(
  "/conversations/:conversationId/typing",
  authenticate,
  validate(conversationIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "create"),
  chatController.notifyTyping,
);

// POST /api/v1/startups/:startupId/chat/messages/:messageId/reactions chat:create
// Toggle semantics: posting the same emoji again removes it.
router.post(
  "/messages/:messageId/reactions",
  authenticate,
  validate(reactionIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "create"),
  validate(toggleReactionSchema),
  chatController.toggleReaction,
);

// DELETE /api/v1/startups/:startupId/chat/messages/:messageId chat:create
// Self-serve only: retracts the caller's own message. ChatService.deleteMessage
// 403s if the message belongs to someone else — there is no moderator override.
router.delete(
  "/messages/:messageId",
  authenticate,
  validate(reactionIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "create"),
  chatController.deleteMessage,
);

// GET /api/v1/startups/:startupId/chat/mentionables chat:read
// Fans out across CRM/team/financial/document types, each filtered by the
// caller's own read permission for that resource see
// ChatService.callerReadableResources.
router.get(
  "/mentionables",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "read"),
  validate(mentionableQuerySchema, "query"),
  chatController.searchMentionables,
);

// POST /api/v1/startups/:startupId/chat/resolve chat:read
// Batch render: one request per message list instead of one per chip.
router.post(
  "/resolve",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "read"),
  validate(resolveMentionsSchema),
  chatController.resolveMentions,
);

// GET /api/v1/startups/:startupId/chat/mentions chat:read
// The backlink query: every message referencing one entity. 403s if the
// caller lacks read access to that entity's own resource (pipeline:read for
// a deal, financial:read for a round, etc), checked inside the service.
router.get(
  "/mentions",
  authenticate,
  validate(startupIdParamSchema, "params"),
  requireMember,
  requirePermission("chat", "read"),
  validate(mentionsBacklinkQuerySchema, "query"),
  chatController.listMentions,
);

export { router as chatRouter };
