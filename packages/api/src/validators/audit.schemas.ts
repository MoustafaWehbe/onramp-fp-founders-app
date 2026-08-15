import { z } from "zod";

export const listAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "page must be at least 1").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
  search: z
    .string()
    .trim()
    .max(100, "search must be at most 100 characters")
    .optional()
    .transform((value) => (value ? value : undefined)),
  entityType: z
    .string()
    .trim()
    .max(50, "entityType must be at most 50 characters")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
