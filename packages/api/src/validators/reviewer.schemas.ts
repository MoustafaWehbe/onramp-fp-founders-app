import { z } from "zod";

export const listReviewerInvitationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional().transform((v) => v || undefined),
  status: z
    .enum(["pending", "opened", "in_review", "completed", "revoked"])
    .optional(),
});

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, "Enter a valid domain, e.g. acme.com");

export const createReviewerInvitationSchema = z.object({
    reviewerName: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(255),
    startupInvestorId: z.string().guid().optional(),
    allowDownload: z.boolean().optional().default(false),
    watermarkEnabled: z.boolean().optional().default(true),
    allowPrint: z.boolean().optional().default(false),
    screenshotGuard: z.boolean().optional().default(true),
    requireNda: z.boolean().optional().default(false),
    password: z.string().trim().min(6).max(100).optional(),
    allowedEmailDomains: z.array(domainSchema).max(10).optional(),
    personalMessage: z.string().trim().max(1000).optional(),
    expiresInDays: z.number().int().min(1).max(90).default(14),
    documentVersionIds: z.array(z.string().guid()).min(1).max(20),
  });

export const invitationIdParamSchema = z.object({
  startupId: z.string().guid(),
  invitationId: z.string().guid(),
});

export type ListReviewerInvitationsQuery = z.infer<typeof listReviewerInvitationsQuerySchema>;
export type CreateReviewerInvitationInput = z.infer<typeof createReviewerInvitationSchema>;
