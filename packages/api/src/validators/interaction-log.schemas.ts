import { z } from "zod";

const interactionTypeEnum = z.enum(["call", "email", "meeting", "note", "other"], {
  error: "Invalid interaction type",
});

function optionalText(max: number, label: string) {
  return z
    .union([z.string().trim().max(max, `${label} must be at most ${max} characters`), z.null()])
    .transform((value) => (value === null || value === "" ? null : value))
    .optional();
}

// z.coerce.date() runs `new Date(input)` on whatever it's given null, false,
// and 0 all coerce to the 1970 epoch instead of failing. Only strings and Date
// instances are legitimate wire representations of a datetime, so anything
// else is forced to NaN first, which z.coerce.date() reliably rejects.
function coercedDate(label: string) {
  return z.preprocess(
    (value) => (typeof value === "string" || value instanceof Date ? value : NaN),
    z.coerce.date({ error: `${label} must be a valid datetime` }),
  );
}

// nextFollowupDate / followupCompletedAt are deliberately absent from both
// schemas: tasks superseded follow-ups, so no new log sets one. Existing rows
// stay readable; they just cannot be written any more.
export const createInteractionLogSchema = z.object({
  investorId: z.string().guid("investorId must be a valid UUID"),
  pipelineId: z.string().guid("pipelineId must be a valid UUID").optional(),
  type: interactionTypeEnum,
  interactionDate: coercedDate("interactionDate"),
  subject: optionalText(200, "Subject"),
  description: optionalText(2000, "Description"),
});

export const updateInteractionLogSchema = z
  .object({
    pipelineId: z
      .union([
        z.string().guid("pipelineId must be a valid UUID"),
        z.null(),
      ])
      .transform((value) => (value === "" || value === null ? null : value))
      .optional(),
    type: interactionTypeEnum.optional(),
    interactionDate: z.union([z.null(), coercedDate("interactionDate")]).optional(),
    subject: optionalText(200, "Subject"),
    description: optionalText(2000, "Description"),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const listInteractionLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "page must be at least 1").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
  source: z.enum(["manual", "google_calendar", "gmail"]).optional(),
});

export const logIdParamSchema = z.object({
  startupId: z.string().guid("startupId must be a valid UUID"),
  logId: z.string().guid("logId must be a valid UUID"),
});

export const investorLogParamSchema = z.object({
  startupId: z.string().guid("startupId must be a valid UUID"),
  investorId: z.string().guid("investorId must be a valid UUID"),
});

export const pipelineLogParamSchema = z.object({
  startupId: z.string().guid("startupId must be a valid UUID"),
  pipelineId: z.string().guid("pipelineId must be a valid UUID"),
});

export type CreateInteractionLogInput = z.infer<typeof createInteractionLogSchema>;
export type UpdateInteractionLogInput = z.infer<typeof updateInteractionLogSchema>;
export type ListInteractionLogQuery = z.infer<typeof listInteractionLogQuerySchema>;