import { z } from "zod";

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
  // Client-generated once per send attempt and reused on retry — see
  // Message.clientNonce in schema.prisma for why this makes a send exactly-once.
  clientNonce: z.string().uuid("clientNonce must be a valid UUID"),
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

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
