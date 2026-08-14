import { z } from "zod";
import { COMMITMENT_STATUSES, ROUND_STATUSES } from "../config/crm";

export { COMMITMENT_STATUSES, ROUND_STATUSES };

const roundStatusEnum = z.enum(ROUND_STATUSES, {
  errorMap: () => ({ message: "Invalid fundraising round status" }),
});
const commitmentStatusEnum = z.enum(COMMITMENT_STATUSES, {
  errorMap: () => ({ message: "Invalid commitment status" }),
});

const money = (field: string) =>
  z
    .number({ invalid_type_error: `${field} must be a number` })
    .finite(`${field} must be a finite number`)
    .min(0, `${field} must be at least 0`);

const currency = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, "currency must be a three-letter ISO code"));

const optionalNullableMoney = (field: string) => z.union([money(field), z.null()]).optional();

export const createFundraisingRoundSchema = z.object({
  roundName: z.string().trim().min(2, "roundName must be at least 2 characters").max(150),
  targetAmount: money("targetAmount"),
  minimumTicketSize: money("minimumTicketSize").optional(),
  equityOfferedPercentage: z
    .number({ invalid_type_error: "equityOfferedPercentage must be a number" })
    .finite("equityOfferedPercentage must be a finite number")
    .min(0, "equityOfferedPercentage must be at least 0")
    .max(100, "equityOfferedPercentage must be at most 100")
    .optional(),
  currency,
  status: roundStatusEnum.optional(),
  // Rolling closes are the norm: money in the door at a first close, the rest
  // by a target final close.
  firstCloseDate: z.coerce.date().optional(),
  targetCloseDate: z.coerce.date().optional(),
});

export const updateFundraisingRoundSchema = z
  .object({
    roundName: z.string().trim().min(2, "roundName must be at least 2 characters").max(150).optional(),
    targetAmount: money("targetAmount").optional(),
    minimumTicketSize: optionalNullableMoney("minimumTicketSize"),
    equityOfferedPercentage: z
      .union([
        z
          .number({ invalid_type_error: "equityOfferedPercentage must be a number" })
          .finite("equityOfferedPercentage must be a finite number")
          .min(0, "equityOfferedPercentage must be at least 0")
          .max(100, "equityOfferedPercentage must be at most 100"),
        z.null(),
      ])
      .optional(),
    currency: currency.optional(),
    status: roundStatusEnum.optional(),
    firstCloseDate: z.union([z.coerce.date(), z.null()]).optional(),
    targetCloseDate: z.union([z.coerce.date(), z.null()]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field is required" });

export const createCommitmentSchema = z.object({
  investorId: z.string().uuid("investorId must be a valid UUID"),
  pipelineId: z.string().uuid("pipelineId must be a valid UUID"),
  roundId: z.string().uuid("roundId must be a valid UUID"),
  amount: money("amount"),
  status: commitmentStatusEnum.optional(),
  expectedCloseDate: z.coerce.date().optional(),
});

export const updateCommitmentSchema = z
  .object({
    amount: money("amount").optional(),
    status: commitmentStatusEnum.optional(),
    expectedCloseDate: z.union([z.coerce.date(), z.null()]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field is required" });

export const fundraisingRoundIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  roundId: z.string().uuid("roundId must be a valid UUID"),
});

export const commitmentIdParamSchema = z.object({
  startupId: z.string().uuid("startupId must be a valid UUID"),
  commitmentId: z.string().uuid("commitmentId must be a valid UUID"),
});

export const listFundraisingRoundsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: roundStatusEnum.optional(),
});

export const listCommitmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: commitmentStatusEnum.optional(),
});

export type CreateFundraisingRoundInput = z.infer<typeof createFundraisingRoundSchema>;
export type UpdateFundraisingRoundInput = z.infer<typeof updateFundraisingRoundSchema>;
export type CreateCommitmentInput = z.infer<typeof createCommitmentSchema>;
export type UpdateCommitmentInput = z.infer<typeof updateCommitmentSchema>;
export type ListFundraisingRoundsQuery = z.infer<typeof listFundraisingRoundsQuerySchema>;
export type ListCommitmentsQuery = z.infer<typeof listCommitmentsQuerySchema>;
