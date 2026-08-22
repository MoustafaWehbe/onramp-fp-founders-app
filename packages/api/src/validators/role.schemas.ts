import { z } from "zod";

const permissionKey = z
  .string()
  .regex(/^[a-z_]+:[a-z_]+$/, "Must be a \"resource:action\" pair");

export const createRoleSchema = z.object({
  name: z.string().trim().min(1, "Role name is required").max(50, "Name must be at most 50 characters"),
  description: z.string().trim().max(200, "Description must be at most 200 characters").optional(),
  permissions: z.array(permissionKey).min(1, "Select at least one permission"),
});

export const updateRoleSchema = z
  .object({
    description: z.string().trim().max(200, "Description must be at most 200 characters").optional(),
    permissions: z.array(permissionKey).optional(),
  })
  .refine((data) => data.description !== undefined || data.permissions !== undefined, {
    message: "At least one field is required",
  });

export const roleIdParamSchema = z.object({
  startupId: z.string().guid("startupId must be a valid UUID"),
  roleId: z.string().guid("roleId must be a valid UUID"),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
