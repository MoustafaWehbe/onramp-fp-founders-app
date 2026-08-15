import { z } from "zod";

const avatarDataUrlSchema = z.string().max(750_000, "Profile photo is too large").refine(
  (value) => /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value),
  "Profile photo must be a JPEG, PNG, or WebP image",
);

const avatarHttpUrlSchema = z
  .string()
  .trim()
  .max(2_048, "Profile photo URL is too long")
  .url("Profile photo URL must be valid")
  .refine((value) => /^https?:\/\//i.test(value), "Profile photo URL must use http or https");

const avatarSchema = z.union([avatarDataUrlSchema, avatarHttpUrlSchema]);

export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(100).optional(),
    lastName: z.string().trim().min(1, "Last name is required").max(100).optional(),
    avatarUrl: avatarSchema.nullable().optional(),
  })
  .refine(
    (data) =>
      data.firstName !== undefined ||
      data.lastName !== undefined ||
      data.avatarUrl !== undefined,
    { message: "At least one field is required" },
  );

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
