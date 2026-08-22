import { z } from "zod";

export const scheduleMeetingSchema = z.object({
  pipelineId: z.string().guid("pipelineId must be a valid UUID").optional(),
  type: z.enum(["call", "meeting"], {
    error: "Type must be call or meeting",
  }),
  startDateTime: z.coerce.date({ error: "startDateTime must be a valid datetime" }),
  durationMinutes: z
    .number()
    .int("durationMinutes must be a whole number")
    .min(5, "durationMinutes must be at least 5")
    .max(480, "durationMinutes must be at most 480"),
  subject: z
    .string()
    .trim()
    .max(200, "Subject must be at most 200 characters")
    .optional(),
  description: z
    .string()
    .trim()
    .max(2000, "Description must be at most 2000 characters")
    .optional(),
});

export type ScheduleMeetingSchemaInput = z.infer<typeof scheduleMeetingSchema>;
