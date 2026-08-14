import { z } from "zod";
import { PIPELINE_STAGES, PRIORITIES } from "../config/crm";

const pipelineStageEnum = z.enum(PIPELINE_STAGES, {
  errorMap: () => ({ message: "Invalid pipeline stage" }),
});

const priorityEnum = z.enum(PRIORITIES, {
  errorMap: () => ({ message: "Invalid priority" }),
});

const optionalInvestorFitScore = z
  .number({ invalid_type_error: "investorFitScore must be a number" })
  .int("investorFitScore must be an integer")
  .min(0, "investorFitScore must be at least 0")
  .max(100, "investorFitScore must be at most 100")
  .optional();

const optionalExpectedAmount = z
  .number({ invalid_type_error: "expectedAmount must be a number" })
  .finite("expectedAmount must be a finite number")
  .min(0, "expectedAmount must be at least 0")
  .optional();

const optionalProbability = z
  .number({ invalid_type_error: "probabilityPercentage must be a number" })
  .int("probabilityPercentage must be an integer")
  .min(0, "probabilityPercentage must be at least 0")
  .max(100, "probabilityPercentage must be at most 100")
  .optional();

export const createPipelineEntrySchema = z.object({
  roundId: z.string().uuid("roundId must be a valid UUID").optional(),
  investorId: z.string().uuid("investorId must be a valid UUID"),
  stage: pipelineStageEnum,
  expectedAmount: optionalExpectedAmount,
  probabilityPercentage: optionalProbability,
  ownerId: z.string().uuid("ownerId must be a valid UUID").optional(),
  priority: priorityEnum.optional(),
  investorFitScore: optionalInvestorFitScore,
});

export const updatePipelineEntrySchema = z
  .object({
    stage: pipelineStageEnum.optional(),
    expectedAmount: z
      .union([
        z
          .number({ invalid_type_error: "expectedAmount must be a number" })
          .finite("expectedAmount must be a finite number")
          .min(0, "expectedAmount must be at least 0"),
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
    // Board position within a stage. The client computes this — typically the
    // midpoint of the two cards it was dropped between — so the server just
    // stores whatever value places it there; it doesn't renumber anything.
    sortOrder: z
      .number({ invalid_type_error: "sortOrder must be a number" })
      .finite("sortOrder must be a finite number")
      .optional(),
    ownerId: z.union([z.string().uuid("ownerId must be a valid UUID"), z.null()]).optional(),
    priority: z.union([priorityEnum, z.null()]).optional(),
    investorFitScore: z
      .union([
        z
          .number({ invalid_type_error: "investorFitScore must be a number" })
          .int("investorFitScore must be an integer")
          .min(0, "investorFitScore must be at least 0")
          .max(100, "investorFitScore must be at most 100"),
        z.null(),
      ])
      .optional(),
    // Required by the server when stage transitions to "passed"; ignored
    // for every other transition.
    reason: z
      .string()
      .trim()
      .min(1, "reason is required")
      .max(500, "reason must be at most 500 characters")
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const listPipelineQuerySchema = z.object({
  roundId: z.string().uuid("roundId must be a valid UUID").optional(),
  page: z.coerce.number().int().min(1, "page must be at least 1").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
  stage: pipelineStageEnum.optional(),
});

export const pipelineAnalyticsQuerySchema = z.object({
  roundId: z.string().uuid("roundId must be a valid UUID").optional(),
});

export const pipelineIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  pipelineId: z.string().uuid("pipelineId must be a valid UUID"),
});

export type CreatePipelineEntryInput = z.infer<typeof createPipelineEntrySchema>;
export type UpdatePipelineEntryInput = z.infer<typeof updatePipelineEntrySchema>;
export type ListPipelineQuery = z.infer<typeof listPipelineQuerySchema>;
