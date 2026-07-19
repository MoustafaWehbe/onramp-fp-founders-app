import { z } from "zod";

const httpUrlSchema = z
  .string()
  .trim()
  .url("Website must be a valid URL")
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "Website must use http or https",
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
});

export type CreateStartupInput = z.infer<typeof createStartupSchema>;
