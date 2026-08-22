import { z } from "zod";

export const sendInvestorEmailSchema = z.object({
  pipelineId: z.string().guid("pipelineId must be a valid UUID").optional(),
  subject: z
    .string()
    .trim()
    .min(1, "Subject is required")
    .max(200, "Subject must be at most 200 characters"),
  body: z
    .string()
    .trim()
    .min(1, "Message is required")
    .max(5000, "Message must be at most 5000 characters"),
});

export type SendInvestorEmailInput = z.infer<typeof sendInvestorEmailSchema>;
