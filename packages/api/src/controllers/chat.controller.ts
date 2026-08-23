import { asyncHandler } from "../utils/errors";
import { chatService } from "../services/chat.service";
import type {
  CreateConversationInput,
  SendMessageInput,
  ListMessagesQuery,
  MentionableQuery,
  ResolveMentionsInput,
  MentionsBacklinkQuery,
  RepliesQuery,
  ToggleReactionInput,
  NotifyLevelInput,
  StartDirectMessageInput,
  ArchiveConversationInput,
  ListConversationsQuery,
} from "../validators/chat.schemas";

export const chatController = {
  createConversation: asyncHandler(async (req, res) => {
    const result = await chatService.createConversation(
      req.params.startupId as string,
      req.body as CreateConversationInput,
      req.user!.userId,
      req.member!.id,
    );
    res.status(201).json(result);
  }),

  startDirectMessage: asyncHandler(async (req, res) => {
    const { memberId } = req.body as StartDirectMessageInput;
    const result = await chatService.startDirectMessage(
      req.params.startupId as string,
      req.member!.id,
      req.user!.userId,
      memberId,
    );
    res.status(201).json(result);
  }),

  listConversations: asyncHandler(async (req, res) => {
    const result = await chatService.listConversations(
      req.params.startupId as string,
      req.member!.id,
      req.query as unknown as ListConversationsQuery,
    );
    res.json(result);
  }),

  listMessages: asyncHandler(async (req, res) => {
    const result = await chatService.listMessages(
      req.params.startupId as string,
      req.params.conversationId as string,
      req.member!.id,
      req.query as unknown as ListMessagesQuery,
    );
    res.json(result);
  }),

  sendMessage: asyncHandler(async (req, res) => {
    const result = await chatService.sendMessage(
      req.params.startupId as string,
      req.params.conversationId as string,
      req.member!.id,
      req.member!.roleId,
      req.body as SendMessageInput,
    );
    res.status(201).json(result);
  }),

  listReplies: asyncHandler(async (req, res) => {
    const { limit } = req.query as unknown as RepliesQuery;
    const result = await chatService.listReplies(
      req.params.startupId as string,
      req.params.conversationId as string,
      req.member!.id,
      req.params.messageId as string,
      limit,
    );
    res.json(result);
  }),

  toggleReaction: asyncHandler(async (req, res) => {
    const { emoji } = req.body as ToggleReactionInput;
    const result = await chatService.toggleReaction(
      req.params.startupId as string,
      req.params.messageId as string,
      req.member!.id,
      emoji,
    );
    res.json(result);
  }),

  deleteMessage: asyncHandler(async (req, res) => {
    const result = await chatService.deleteMessage(
      req.params.startupId as string,
      req.params.messageId as string,
      req.member!.id,
      req.user!.userId,
    );
    res.json(result);
  }),

  setConversationArchived: asyncHandler(async (req, res) => {
    const { archived } = req.body as ArchiveConversationInput;
    const result = await chatService.setConversationArchived(
      req.params.startupId as string,
      req.params.conversationId as string,
      archived,
      req.member!.id,
      req.user!.userId,
    );
    res.json(result);
  }),

  markRead: asyncHandler(async (req, res) => {
    const result = await chatService.markRead(
      req.params.startupId as string,
      req.params.conversationId as string,
      req.member!.id,
    );
    res.json(result);
  }),

  setNotifyLevel: asyncHandler(async (req, res) => {
    const { level } = req.body as NotifyLevelInput;
    const result = await chatService.setNotifyLevel(
      req.params.startupId as string,
      req.params.conversationId as string,
      req.member!.id,
      level,
    );
    res.json(result);
  }),

  notifyTyping: asyncHandler(async (req, res) => {
    await chatService.notifyTyping(
      req.params.startupId as string,
      req.params.conversationId as string,
      req.member!.id,
    );
    res.status(204).send();
  }),

  searchMentionables: asyncHandler(async (req, res) => {
    const result = await chatService.searchMentionables(
      req.params.startupId as string,
      req.member!.roleId,
      req.query as unknown as MentionableQuery,
    );
    res.json(result);
  }),

  resolveMentions: asyncHandler(async (req, res) => {
    const { items } = req.body as ResolveMentionsInput;
    const result = await chatService.resolveMentions(
      req.params.startupId as string,
      req.member!.roleId,
      items,
    );
    res.json(result);
  }),

  listMentions: asyncHandler(async (req, res) => {
    const { targetType, targetId, limit } = req.query as unknown as MentionsBacklinkQuery;
    const result = await chatService.getMentionsForTarget(
      req.params.startupId as string,
      req.member!.id,
      req.member!.roleId,
      targetType,
      targetId,
      limit,
    );
    res.json(result);
  }),
};
