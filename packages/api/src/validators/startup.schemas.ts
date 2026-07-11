import { z } from "zod";

export const createStartupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Startup name is required")
    .max(100, "Name must be at most 100 characters"),
  description: z
    .string()
    .trim()
    .max(500, "Description must be at most 500 characters")
    .optional(),
  industry: z.string().trim().max(100).optional(),
  website: z
    .string()
    .trim()
    .url("Website must be a valid URL")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  funding_stage: z
    .enum(["pre_seed", "seed", "series_a", "series_b", "series_c"])
    .optional(),
});

export type CreateStartupInput = z.infer<typeof createStartupSchema>;
