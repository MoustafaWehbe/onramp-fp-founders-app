import { asyncHandler } from "../utils/errors";
import { chatService } from "../services/chat.service";
import type {
  CreateConversationInput,
  SendMessageInput,
  ListMessagesQuery,
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
};
