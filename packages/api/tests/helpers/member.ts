import { PERMISSIONS } from "../../src/config/permissions";

/**
 * The membership row `requireMember` reads, including the role's grants.
 *
 * Route gates no longer issue a permission query of their own: everything a
 * request is allowed to do is resolved once, here, from the membership.
 * Controller tests therefore vary access by varying this row rather than by
 * mocking `prisma.rolePermission.findFirst`.
 */
export function activeMember(
  overrides: { id?: string; userId: string; startupId: string; roleId?: string; roleName?: string; permissions?: readonly string[] },
) {
  const roleName = overrides.roleName ?? "owner";
  const keys = overrides.permissions ?? PERMISSIONS.map((p) => `${p.resource}:${p.action}`);

  return {
    id: overrides.id ?? "member-1",
    userId: overrides.userId,
    startupId: overrides.startupId,
    roleId: overrides.roleId ?? "role-owner",
    status: "active",
    role: {
      name: roleName,
      rolePermissions: keys.map((key) => {
        const [resource, action] = key.split(":");
        return { permission: { resource: resource!, action: action! } };
      }),
    },
  };
}

/** The same row with one grant removed, for "returns 403 when the role lacks X" cases. */
export function memberWithout(
  base: ReturnType<typeof activeMember>,
  ...withheld: string[]
): ReturnType<typeof activeMember> {
  const denied = new Set(withheld);
  return {
    ...base,
    role: {
      ...base.role,
      rolePermissions: base.role.rolePermissions.filter(
        (rp) => !denied.has(`${rp.permission.resource}:${rp.permission.action}`),
      ),
    },
  };
}
