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
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationIdParamSchema = z.object({
  notificationId: z.string().uuid("Invalid notification ID"),
});
