import { z } from "zod";

const interactionTypeEnum = z.enum(["call", "email", "meeting", "note", "other"], {
  errorMap: () => ({ message: "Invalid interaction type" }),
});

function optionalText(max: number, label: string) {
  return z
    .union([z.string().trim().max(max, `${label} must be at most ${max} characters`), z.null()])
    .transform((value) => (value === null || value === "" ? null : value))
    .optional();
}

const optionalDatetime = z
  .union([z.coerce.date(), z.null()])
  .transform((value) => (value === null ? null : value))
  .optional();

export const createInteractionLogSchema = z.object({
  investorId: z.string().uuid("investorId must be a valid UUID"),
  pipelineId: z.string().uuid("pipelineId must be a valid UUID").optional(),
  type: interactionTypeEnum,
  interactionDate: z.coerce.date({
    invalid_type_error: "interactionDate must be a valid datetime",
  }),
  subject: optionalText(200, "Subject"),
  description: optionalText(2000, "Description"),
  nextFollowupDate: optionalDatetime,
});

export const updateInteractionLogSchema = z
  .object({
    pipelineId: z
      .union([
        z.string().uuid("pipelineId must be a valid UUID"),
        z.null(),
      ])
      .transform((value) => (value === "" || value === null ? null : value))
      .optional(),
    type: interactionTypeEnum.optional(),
    interactionDate: z
      .union([
        z.coerce.date({
          invalid_type_error: "interactionDate must be a valid datetime",
        }),
        z.null(),
      ])
      .optional(),
    subject: optionalText(200, "Subject"),
    description: optionalText(2000, "Description"),
    nextFollowupDate: optionalDatetime,
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
});

export const logIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  logId: z.string().uuid("logId must be a valid UUID"),
});

export const investorLogParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  investorId: z.string().uuid("investorId must be a valid UUID"),
});

export const pipelineLogParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  pipelineId: z.string().uuid("pipelineId must be a valid UUID"),
});

export type CreateInteractionLogInput = z.infer<typeof createInteractionLogSchema>;
export type UpdateInteractionLogInput = z.infer<typeof updateInteractionLogSchema>;
export type ListInteractionLogQuery = z.infer<typeof listInteractionLogQuerySchema>;