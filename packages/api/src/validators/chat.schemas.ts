import { z } from "zod";
import { MENTION_TARGET_TYPES } from "../utils/mentions";

const mentionTargetTypeEnum = z.enum(MENTION_TARGET_TYPES, {
  errorMap: () => ({ message: "Invalid mention type" }),
});

export const createConversationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(60, "Name must be at most 60 characters"),
  topic: z
    .union([z.string().trim().max(200, "Topic must be at most 200 characters"), z.null()])
    .transform((value) => (value === null || value === "" ? null : value))
    .optional(),
});

export const conversationIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  conversationId: z.string().uuid("conversationId must be a valid UUID"),
});

export const sendMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Message body is required")
    .max(4000, "Message must be at most 4000 characters"),
  // Client-generated once per send attempt and reused on retry see
  // Message.clientNonce in schema.prisma for why this makes a send exactly-once.
  clientNonce: z.string().uuid("clientNonce must be a valid UUID"),
  // Set to reply in a thread. Must name a top-level message in the same
  // conversation enforced in ChatService, not here, since it needs a DB lookup.
  parentMessageId: z.string().uuid("parentMessageId must be a valid UUID").optional(),
  // Vault documents to attach, beyond anything referenced inline with @doc.
  documentIds: z.array(z.string().uuid("documentIds must be valid UUIDs")).max(10).optional(),
});

export const messageIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  conversationId: z.string().uuid("conversationId must be a valid UUID"),
  messageId: z.string().uuid("messageId must be a valid UUID"),
});

export const repliesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const reactionIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  messageId: z.string().uuid("messageId must be a valid UUID"),
});

export const toggleReactionSchema = z.object({
  // A short fixed palette on the client (see REACTION_EMOJIS in lib/mentions.ts) —
  // the server just bounds the length rather than validating against a list,
  // so an older/newer client's palette never gets rejected outright.
  emoji: z.string().trim().min(1, "emoji is required").max(16, "emoji must be at most 16 characters"),
});

export const archiveConversationSchema = z.object({
  archived: z.boolean(),
});

export const notifyLevelSchema = z.object({
  level: z.enum(["all", "mentions", "none"], {
    errorMap: () => ({ message: "level must be one of: all, mentions, none" }),
  }),
});

export const startDirectMessageSchema = z.object({
  memberId: z.string().uuid("memberId must be a valid UUID"),
});

export const listMessagesQuerySchema = z.object({
  // Cursor pagination on `seq`: returns messages with seq < before, newest
  // first. Omitted on the first page load.
  before: z
    .string()
    .regex(/^\d+$/, "before must be a numeric sequence value")
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(50),
});

export const mentionableQuerySchema = z.object({
  q: z.string().trim().max(120, "q must be at most 120 characters").default(""),
  // Comma-separated in the URL, e.g. "investor,deal" narrows the picker
  // once the composer knows the user typed "@deal:" or similar.
  types: z.preprocess(
    (value) =>
      typeof value === "string" && value.length > 0 ? value.split(",").filter(Boolean) : undefined,
    z.array(mentionTargetTypeEnum).optional(),
  ),
});

export const resolveMentionsSchema = z.object({
  items: z
    .array(
      z.object({
        type: mentionTargetTypeEnum,
        id: z.string().uuid("id must be a valid UUID"),
      }),
    )
    .min(1, "At least one item is required")
    .max(50, "At most 50 items per request"),
});

export const mentionsBacklinkQuerySchema = z.object({
  targetType: mentionTargetTypeEnum,
  targetId: z.string().uuid("targetId must be a valid UUID"),
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(50, "limit must be at most 50")
    .default(20),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
export type MentionableQuery = z.infer<typeof mentionableQuerySchema>;
export type ResolveMentionsInput = z.infer<typeof resolveMentionsSchema>;
export type MentionsBacklinkQuery = z.infer<typeof mentionsBacklinkQuerySchema>;
export type RepliesQuery = z.infer<typeof repliesQuerySchema>;
export type ToggleReactionInput = z.infer<typeof toggleReactionSchema>;
export type NotifyLevelInput = z.infer<typeof notifyLevelSchema>;
export type ArchiveConversationInput = z.infer<typeof archiveConversationSchema>;
export type StartDirectMessageInput = z.infer<typeof startDirectMessageSchema>;
