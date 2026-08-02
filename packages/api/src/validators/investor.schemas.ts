import { z } from "zod";
import { INVESTOR_TYPES, PIPELINE_STAGES } from "../config/crm";

const investorTypeEnum = z.enum(INVESTOR_TYPES, {
  errorMap: () => ({ message: "Invalid investor type" }),
});

const pipelineStageEnum = z.enum(PIPELINE_STAGES, {
  errorMap: () => ({ message: "Invalid pipeline stage" }),
});

function optionalText(max: number, label: string) {
  return z
    .union([z.string().trim().max(max, `${label} must be at most ${max} characters`), z.null()])
    .transform((value) => (value === null || value === "" ? null : value))
    .optional();
}

const optionalEmail = z
  .union([
    z.string().trim().toLowerCase().email("Invalid email address"),
    z.literal(""),
    z.null(),
  ])
  .transform((value) => (value === null || value === "" ? null : value))
  .optional();

const optionalLinkedinUrl = z
  .union([
    z
      .string()
      .trim()
      .url("LinkedIn URL must be a valid URL")
      .refine((value) => /^https?:\/\//i.test(value), {
        message: "LinkedIn URL must use http or https",
      }),
    z.literal(""),
    z.null(),
  ])
  .transform((value) => (value === null || value === "" ? null : value))
  .optional();

const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Full name must be at least 2 characters")
  .max(150, "Full name must be at most 150 characters");

const investorFields = {
  email: optionalEmail,
  ventureFirm: optionalText(150, "Venture firm"),
  investorType: z.union([investorTypeEnum, z.null()]).optional(),
  sectorFocus: optionalText(200, "Sector focus"),
  investmentStagePreference: optionalText(200, "Investment stage preference"),
  linkedinUrl: optionalLinkedinUrl,
  notes: optionalText(2000, "Notes"),
  source: optionalText(100, "Source"),
};

export const createInvestorSchema = z.object({
  fullName: fullNameSchema,
  ...investorFields,
});

export const updateInvestorSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    ...investorFields,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const listInvestorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "page must be at least 1").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
  // `?search=` is how a cleared search box serializes — treat it as "no filter"
  // rather than rejecting the request.
  search: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  investorType: investorTypeEnum.optional(),
  stage: pipelineStageEnum.optional(),
});

export const investorIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  investorId: z.string().uuid("investorId must be a valid UUID"),
});

export type CreateInvestorInput = z.infer<typeof createInvestorSchema>;
export type UpdateInvestorInput = z.infer<typeof updateInvestorSchema>;
export type ListInvestorsQuery = z.infer<typeof listInvestorsQuerySchema>;
