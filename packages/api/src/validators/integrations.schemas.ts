import { z } from "zod";

// Google's redirect either carries a code to exchange, or an error (most
// commonly "access_denied", when the founder declines consent) never both.
export const googleCallbackQuerySchema = z.union([
  z.object({ code: z.string().min(1), state: z.string().min(1) }),
  z.object({ error: z.string().min(1), state: z.string().optional() }),
]);

export type GoogleCallbackQuery = z.infer<typeof googleCallbackQuerySchema>;

export const calendarSyncSettingSchema = z.object({
  enabled: z.boolean(),
});

export type CalendarSyncSettingInput = z.infer<typeof calendarSyncSettingSchema>;
