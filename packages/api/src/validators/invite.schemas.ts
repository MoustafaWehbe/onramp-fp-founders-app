import { z } from "zod";

export const inviteMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address"),
  roleId: z.string().guid("Invalid role ID"),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const changeRoleSchema = z.object({
  roleId: z.string().guid("Invalid role ID"),
});

export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const memberIdParamSchema = z.object({
  startupId: z.string().guid("Invalid startup ID"),
  memberId: z.string().guid("Invalid member ID"),
});