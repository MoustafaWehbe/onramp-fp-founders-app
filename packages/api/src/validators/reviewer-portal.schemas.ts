import { z } from "zod";

export const reviewerAccessSchema = z.object({
  token: z.string().trim().min(20).max(200),
});

export const reviewerVerifySchema = z.object({
  token: z.string().trim().min(20).max(200),
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must be a 6-digit code"),
});

export const reviewerCommentSchema = z.object({
  documentId: z.string().uuid().optional(),
  chunkId: z.string().uuid().optional(),
  commentText: z.string().trim().min(1).max(4000),
});

export const reviewerDocumentIdParamSchema = z.object({
  documentId: z.string().uuid(),
});

export type ReviewerAccessInput = z.infer<typeof reviewerAccessSchema>;
export type ReviewerVerifyInput = z.infer<typeof reviewerVerifySchema>;
export type ReviewerCommentInput = z.infer<typeof reviewerCommentSchema>;
