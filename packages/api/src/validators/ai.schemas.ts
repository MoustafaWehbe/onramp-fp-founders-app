import { z } from "zod";

const uuid = z.string().uuid();

export const aiSessionIdParamSchema = z.object({
  startupId: uuid,
  sessionId: uuid,
});

export const aiMessageStreamParamSchema = z.object({
  startupId: uuid,
  sessionId: uuid,
  messageId: uuid,
});

export const listAiSessionsQuerySchema = z.object({
  archived: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const createAiSessionSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  contextMode: z.enum(["selected", "workspace"]).default("selected"),
  roundId: uuid.optional(),
  documentVersionIds: z.array(uuid).max(10).default([]),
});

export const updateAiSessionSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  archived: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

export const createAiMessageSchema = z.object({
  content: z.string().trim().min(1).max(12_000),
  clientRequestId: uuid,
});

export type CreateAiSessionInput = z.infer<typeof createAiSessionSchema>;
export type UpdateAiSessionInput = z.infer<typeof updateAiSessionSchema>;
export type ListAiSessionsQuery = z.infer<typeof listAiSessionsQuerySchema>;
export type CreateAiMessageInput = z.infer<typeof createAiMessageSchema>;
