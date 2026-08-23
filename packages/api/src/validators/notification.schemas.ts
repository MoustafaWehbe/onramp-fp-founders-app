import { z } from "zod";

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(30),
  // Accepts the bare `?unread` flag as well as an explicit value.
  unread: z
    .union([z.literal("true"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === "true" || v === ""),
  // Scopes both the list and unreadCount to one workspace - e.g. the
  // currently active one - instead of the global cross-workspace feed.
  // Omitted entirely (not just falsy) means "every workspace".
  startupId: z.string().guid().optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationIdParamSchema = z.object({
  notificationId: z.string().guid("Invalid notification ID"),
});

// Same scoping as listNotificationsQuerySchema's startupId, so "mark all
// read" never clears more than what the caller's own feed currently shows.
export const markAllReadBodySchema = z.object({
  startupId: z.string().guid().optional(),
});

export type MarkAllReadInput = z.infer<typeof markAllReadBodySchema>;
