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
    z.coerce.date({ invalid_type_error: `${label} must be a valid datetime` }),
  );
}

// Structured comparables the AI copilot reads to judge investor/pitch fit.
// All nullable and all optional in the UI no migration backfill, no
// required-at-creation gate.
const profileFields = {
  oneLiner: optionalText(200, "One-liner"),
  problemStatement: optionalText(2000, "Problem statement"),
  solutionSummary: optionalText(2000, "Solution summary"),
  targetMarket: optionalText(1000, "Target market"),
  businessModel: optionalText(2000, "Business model"),
  tractionSummary: optionalText(2000, "Traction summary"),
  competitiveEdge: optionalText(2000, "Competitive edge"),
  headquarters: optionalText(200, "Headquarters"),
  foundedAt: z.union([z.null(), coercedDate("foundedAt")]).optional(),
  teamSummary: optionalText(2000, "Team summary"),
};
const PROFILE_FIELD_NAMES = Object.keys(profileFields) as Array<keyof typeof profileFields>;

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
    ...profileFields,
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.industry !== undefined ||
      data.website !== undefined ||
      data.funding_stage !== undefined ||
      data.fundingStage !== undefined ||
      PROFILE_FIELD_NAMES.some((field) => data[field] !== undefined),
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
    ...(data.oneLiner !== undefined && { oneLiner: data.oneLiner }),
    ...(data.problemStatement !== undefined && { problemStatement: data.problemStatement }),
    ...(data.solutionSummary !== undefined && { solutionSummary: data.solutionSummary }),
    ...(data.targetMarket !== undefined && { targetMarket: data.targetMarket }),
    ...(data.businessModel !== undefined && { businessModel: data.businessModel }),
    ...(data.tractionSummary !== undefined && { tractionSummary: data.tractionSummary }),
    ...(data.competitiveEdge !== undefined && { competitiveEdge: data.competitiveEdge }),
    ...(data.headquarters !== undefined && { headquarters: data.headquarters }),
    ...(data.foundedAt !== undefined && { foundedAt: data.foundedAt }),
    ...(data.teamSummary !== undefined && { teamSummary: data.teamSummary }),
  }));

export const startupIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
});

export type CreateStartupInput = z.infer<typeof createStartupSchema>;
export type UpdateStartupInput = z.infer<typeof updateStartupSchema>;
