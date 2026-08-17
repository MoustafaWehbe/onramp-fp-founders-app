import { z } from "zod";

// Profile photos go through PUT/DELETE /users/me/avatar (raw image bytes,
// stored via storage.service.ts), not through this JSON body embedding a
// ~700KB base64 image in every profile edit made every avatar-carrying
// response (chat messages, member lists) balloon with a duplicated copy of it.
export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(100).optional(),
    lastName: z.string().trim().min(1, "Last name is required").max(100).optional(),
  })
  .refine((data) => data.firstName !== undefined || data.lastName !== undefined, {
    message: "At least one field is required",
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
