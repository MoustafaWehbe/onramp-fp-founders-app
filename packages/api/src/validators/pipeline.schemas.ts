import { z } from "zod";
import { PIPELINE_STAGES } from "../config/crm";

const pipelineStageEnum = z.enum(PIPELINE_STAGES, {
  errorMap: () => ({ message: "Invalid pipeline stage" }),
});

const optionalExpectedAmount = z
  .number({ invalid_type_error: "expectedAmount must be a number" })
  .finite("expectedAmount must be a finite number")
  .optional();

const optionalProbability = z
  .number({ invalid_type_error: "probabilityPercentage must be a number" })
  .int("probabilityPercentage must be an integer")
  .min(0, "probabilityPercentage must be at least 0")
  .max(100, "probabilityPercentage must be at most 100")
  .optional();

export const createPipelineEntrySchema = z.object({
  investorId: z.string().uuid("investorId must be a valid UUID"),
  stage: pipelineStageEnum,
  expectedAmount: optionalExpectedAmount,
  probabilityPercentage: optionalProbability,
});

export const updatePipelineEntrySchema = z
  .object({
    stage: pipelineStageEnum.optional(),
    expectedAmount: z
      .union([
        z
          .number({ invalid_type_error: "expectedAmount must be a number" })
          .finite("expectedAmount must be a finite number"),
        z.null(),
      ])
      .optional(),
    probabilityPercentage: z
      .union([
        z
          .number({ invalid_type_error: "probabilityPercentage must be a number" })
          .int("probabilityPercentage must be an integer")
          .min(0, "probabilityPercentage must be at least 0")
          .max(100, "probabilityPercentage must be at most 100"),
        z.null(),
      ])
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const listPipelineQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "page must be at least 1").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
  stage: pipelineStageEnum.optional(),
});

export const pipelineIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  pipelineId: z.string().uuid("pipelineId must be a valid UUID"),
});

export type CreatePipelineEntryInput = z.infer<typeof createPipelineEntrySchema>;
export type UpdatePipelineEntryInput = z.infer<typeof updatePipelineEntrySchema>;
export type ListPipelineQuery = z.infer<typeof listPipelineQuerySchema>;
