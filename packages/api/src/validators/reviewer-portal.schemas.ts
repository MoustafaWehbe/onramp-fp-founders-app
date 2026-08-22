import { z } from "zod";

export const reviewerAccessSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().trim().min(1).max(100).optional(),
});

export const reviewerVerifySchema = z.object({
  token: z.string().trim().min(20).max(200),
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must be a 6-digit code"),
});

export const reviewerCommentSchema = z.object({
  documentId: z.string().guid().optional(),
  chunkId: z.string().guid().optional(),
  commentText: z.string().trim().min(1).max(4000),
});

export const reviewerDocumentIdParamSchema = z.object({
  documentId: z.string().guid(),
});

export const reviewerVersionIdParamSchema = z.object({
  versionId: z.string().guid(),
});

export const reviewerPageParamSchema = z.object({
  versionId: z.string().guid(),
  // Bounded by MAX_RASTER_PAGES; a page number outside it can never resolve, so
  // reject it before it reaches a query.
  pageNumber: z.coerce.number().int().min(1).max(200),
});

export const reviewerPageQuerySchema = z.object({
  t: z.string().min(10).max(400),
  kind: z.enum(["view", "thumb"]).default("view"),
});

// Deliberately not the full event-type list from the analytics plan — only the
// types the Phase 2 client guards actually emit. No free-form metadata field:
// this endpoint is client-controlled and public-facing, so the shape stays
// closed rather than accepting arbitrary JSON.
export const reviewerEventSchema = z.object({
  type: z.enum(["copy_attempt", "print_attempt", "screenshot_attempt"]),
  documentVersionId: z.string().guid().optional(),
  pageNumber: z.coerce.number().int().min(1).max(200).optional(),
});

// Dwell-time only — capture-deterrent attempts go through /events (Phase 2).
// Server clamps activeMs to a tighter ceiling than this; the schema bound is
// just a sanity gate against an absurd single value.
export const reviewerTelemetrySchema = z.object({
  pages: z
    .array(
      z.object({
        documentVersionId: z.string().guid(),
        pageNumber: z.coerce.number().int().min(1).max(200),
        activeMs: z.number().int().min(0).max(120_000),
      }),
    )
    .max(50),
});

export type ReviewerAccessInput = z.infer<typeof reviewerAccessSchema>;
export type ReviewerVerifyInput = z.infer<typeof reviewerVerifySchema>;
export type ReviewerCommentInput = z.infer<typeof reviewerCommentSchema>;
export type ReviewerPageParams = z.infer<typeof reviewerPageParamSchema>;
export type ReviewerPageQuery = z.infer<typeof reviewerPageQuerySchema>;
export type ReviewerEventInput = z.infer<typeof reviewerEventSchema>;
export type ReviewerTelemetryInput = z.infer<typeof reviewerTelemetrySchema>;
