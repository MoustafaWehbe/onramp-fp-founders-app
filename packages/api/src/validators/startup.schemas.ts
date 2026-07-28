import { z } from "zod";

const httpUrlSchema = z
  .string()
  .trim()
  .url("Website must be a valid URL")
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "Website must use http or https",
  });
const fundingStageEnum = z.enum(["pre_seed", "seed", "series_a", "series_b", "series_c"], {
  errorMap: () => ({ message: "Invalid funding stage" }),
});

export const createStartupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Startup name is required")
    .max(100, "Name must be at most 100 characters"),
  description: z
    .string()
    .trim()
    .min(1, "Description is required")
    .max(500, "Description must be at most 500 characters"),
  industry: z
    .string()
    .trim()
    .min(1, "Industry is required")
    .max(100, "Industry must be at most 100 characters"),
  website: httpUrlSchema,
  funding_stage: z.enum(["pre_seed", "seed", "series_a", "series_b", "series_c"], {
    errorMap: () => ({ message: "Funding stage is required" }),
  }),
  website: z.string().trim().url("Website must be a valid URL"),
  funding_stage: fundingStageEnum,
});

export const updateStartupSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Startup name is required")
      .max(100, "Name must be at most 100 characters")
      .optional(),
    description: z
      .string()
      .trim()
      .min(1, "Description is required")
      .max(500, "Description must be at most 500 characters")
      .optional(),
    industry: z
      .string()
      .trim()
      .min(1, "Industry is required")
      .max(100, "Industry must be at most 100 characters")
      .optional(),
    website: z.string().trim().url("Website must be a valid URL").optional(),
    funding_stage: fundingStageEnum.optional(),
    fundingStage: fundingStageEnum.optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.industry !== undefined ||
      data.website !== undefined ||
      data.funding_stage !== undefined ||
      data.fundingStage !== undefined,
    { message: "At least one field is required" },
  )
  .transform((data) => ({
    ...(data.name !== undefined && { name: data.name }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.industry !== undefined && { industry: data.industry }),
    ...(data.website !== undefined && { website: data.website }),
    ...((data.fundingStage ?? data.funding_stage) !== undefined && {
      fundingStage: data.fundingStage ?? data.funding_stage,
    }),
  }));

export const startupIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
});

export type CreateStartupInput = z.infer<typeof createStartupSchema>;
export type UpdateStartupInput = z.infer<typeof updateStartupSchema>;
