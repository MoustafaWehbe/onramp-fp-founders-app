import { asyncHandler } from "../utils/errors";
import { chatService } from "../services/chat.service";
import type {
  CreateConversationInput,
  SendMessageInput,
  ListMessagesQuery,
  MentionableQuery,
  ResolveMentionsInput,
  MentionsBacklinkQuery,
} from "../validators/chat.schemas";

export const chatController = {
  createConversation: asyncHandler(async (req, res) => {
    const result = await chatService.createConversation(
      req.params.startupId as string,
      req.body as CreateConversationInput,
      req.user!.userId,
    );
    res.status(201).json(result);
  }),

  listConversations: asyncHandler(async (req, res) => {
    const result = await chatService.listConversations(
      req.params.startupId as string,
      req.member!.id,
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
      req.body as SendMessageInput,
    );
    res.status(201).json(result);
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
