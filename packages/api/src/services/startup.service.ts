import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import type { CreateStartupInput, UpdateStartupInput } from "../validators/startup.schemas";
import type { CreateRoleInput, UpdateRoleInput } from "../validators/role.schemas";
import { ROLE_DEFINITIONS, ROLE_TEMPLATES } from "../config/permissions";

/** "resource:action" strings, computed from a role's live RolePermission rows. */
function permissionKeys(rolePermissions: { permission: { resource: string; action: string } }[]): string[] {
  return rolePermissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`);
}

const STARTUP_SELECT = {
  id: true,
  name: true,
  description: true,
  industry: true,
  website: true,
  fundingStage: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class StartupService {
  async createStartup(input: CreateStartupInput, userId: string) {
    return prisma.$transaction(async (tx) => {
      // 1. Create the startup
      const startup = await tx.startup.create({
        data: {
          name: input.name,
          description: input.description,
          industry: input.industry,
          website: input.website,
          fundingStage: input.funding_stage,
          createdBy: userId,
        },
        select: STARTUP_SELECT,
      });

      // 2. Fetch all global permissions once
      const allPermissions = await tx.permission.findMany();
      const byKey = new Map(allPermissions.map((p) => [`${p.resource}:${p.action}`, p]));

      // 3. Create the three system roles and wire their permissions
      let ownerRoleId = "";

      for (const { name, description } of ROLE_DEFINITIONS) {
        const role = await tx.role.create({
          data: { startupId: startup.id, name, description, isSystemRole: true },
        });

        if (name === "owner") ownerRoleId = role.id;

        const keys = name === "owner"
          ? allPermissions.map((p) => `${p.resource}:${p.action}`)
          : ROLE_TEMPLATES[name as keyof typeof ROLE_TEMPLATES];

        const missing = keys.filter((k) => !byKey.has(k));
        if (missing.length > 0) {
          throw new Error(`Missing permission rows for: ${missing.join(", ")}`);
        }

        const permRows = keys.map((k) => ({
          roleId: role.id,
          permissionId: byKey.get(k)!.id,
        }));

        if (permRows.length > 0) {
          await tx.rolePermission.createMany({ data: permRows });
        }
      }

      if (!ownerRoleId) {
        throw new Error("System role 'owner' was not created");
      }

      // 4. Create the founder's membership with the owner role
      const member = await tx.startupMember.create({
        data: {
          startupId: startup.id,
          userId,
          roleId: ownerRoleId,
          status: "active",
          joinedAt: new Date(),
        },
      });

      // 5. Set this startup as the user's active workspace
      await tx.user.update({
        where: { id: userId },
        data: { lastActiveStartupId: startup.id },
      });

      return { startup, member };
    });
  }

  /**
   * Every workspace the caller can actually open. Scoped by membership rather
   * than by a startup id, so this is the one startup endpoint that cannot use
   * requireMember — it is what the client calls before it knows which startup
   * it is in.
   */
  async listMyStartups(userId: string) {
    const memberships = await prisma.startupMember.findMany({
      where: { userId, status: "active" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        joinedAt: true,
        role: {
          select: {
            name: true,
            rolePermissions: { select: { permission: { select: { resource: true, action: true } } } },
          },
        },
        startup: { select: STARTUP_SELECT },
      },
    });

    return memberships.map((m) => ({
      ...m.startup,
      member: {
        id: m.id,
        status: m.status,
        role: m.role.name,
        permissions: permissionKeys(m.role.rolePermissions),
        joinedAt: m.joinedAt,
      },
    }));
  }

  /**
   * Records the workspace this user is now working in. requireMember has
   * already established they belong to it, so no further check is needed.
   */
  async setActiveStartup(startupId: string, userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { lastActiveStartupId: startupId },
    });
  }

  async getStartup(startupId: string, userId: string) {
    const startup = await prisma.startup.findUnique({
      where: { id: startupId },
      select: STARTUP_SELECT,
    });
    if (!startup) throw createError("Startup not found", 404, "NOT_FOUND");

    const membership = await prisma.startupMember.findUnique({
      where: { startupId_userId: { startupId, userId } },
      include: {
        role: {
          select: {
            name: true,
            rolePermissions: { select: { permission: { select: { resource: true, action: true } } } },
          },
        },
      },
    });
    if (!membership || membership.status !== "active") {
      throw createError("Forbidden", 403, "FORBIDDEN");
    }

    return {
      startup,
      member: {
        id: membership.id,
        status: membership.status,
        role: membership.role.name,
        permissions: permissionKeys(membership.role.rolePermissions),
        joinedAt: membership.joinedAt,
      },
    };
  }

  async updateStartup(startupId: string, input: UpdateStartupInput) {
    const existing = await prisma.startup.findUnique({ where: { id: startupId }, select: { id: true } });
    if (!existing) throw createError("Startup not found", 404, "NOT_FOUND");

    return prisma.startup.update({
      where: { id: startupId },
      data: input,
      select: STARTUP_SELECT,
    });
  }

  async deleteStartup(startupId: string) {
    const existing = await prisma.startup.findUnique({ where: { id: startupId }, select: { id: true } });
    if (!existing) throw createError("Startup not found", 404, "NOT_FOUND");

    await prisma.$transaction([
      prisma.user.updateMany({
        where: { lastActiveStartupId: startupId },
        data: { lastActiveStartupId: null },
      }),
      prisma.startup.delete({ where: { id: startupId } }),
    ]);
  }

  async listRoles(startupId: string) {
    const roles = await prisma.role.findMany({
      where: { startupId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        isSystemRole: true,
        rolePermissions: { select: { permission: { select: { resource: true, action: true } } } },
        _count: { select: { members: true } },
      },
    });

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystemRole: r.isSystemRole,
      permissions: permissionKeys(r.rolePermissions),
      memberCount: r._count.members,
    }));
  }

  /** Validates that every requested key is a real "resource:action" pair, returning their ids. */
  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    const unique = [...new Set(keys)];
    const rows = await prisma.permission.findMany({
      where: { OR: unique.map((k) => {
        const [resource, action] = k.split(":");
        return { resource, action };
      }) },
      select: { id: true, resource: true, action: true },
    });

    const byKey = new Map(rows.map((p) => [`${p.resource}:${p.action}`, p.id]));
    const missing = unique.filter((k) => !byKey.has(k));
    if (missing.length > 0) {
      throw createError(`Unknown permission(s): ${missing.join(", ")}`, 400, "UNKNOWN_PERMISSION");
    }

    return unique.map((k) => byKey.get(k)!);
  }

  async createRole(startupId: string, input: CreateRoleInput) {
    const permissionIds = await this.resolvePermissionIds(input.permissions);

    try {
      return await prisma.$transaction(async (tx) => {
        const role = await tx.role.create({
          data: {
            startupId,
            name: input.name,
            description: input.description ?? null,
            isSystemRole: false,
          },
        });

        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        });

        return { id: role.id, name: role.name, description: role.description, isSystemRole: false, permissions: input.permissions, memberCount: 0 };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw createError("A role with that name already exists in this workspace", 409, "ROLE_NAME_TAKEN");
      }
      throw err;
    }
  }

  async updateRole(startupId: string, roleId: string, input: UpdateRoleInput) {
    const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true, startupId: true, name: true } });
    if (!role || role.startupId !== startupId) {
      throw createError("Role not found in this startup", 404, "ROLE_NOT_FOUND");
    }
    if (role.name === "owner") {
      throw createError("The owner role's permissions can't be changed", 403, "OWNER_ROLE_LOCKED");
    }

    const permissionIds = input.permissions ? await this.resolvePermissionIds(input.permissions) : null;

    return prisma.$transaction(async (tx) => {
      if (input.description !== undefined) {
        await tx.role.update({ where: { id: roleId }, data: { description: input.description } });
      }

      if (permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
          });
        }
      }

      const updated = await tx.role.findUniqueOrThrow({
        where: { id: roleId },
        select: {
          id: true,
          name: true,
          description: true,
          isSystemRole: true,
          rolePermissions: { select: { permission: { select: { resource: true, action: true } } } },
          _count: { select: { members: true } },
        },
      });

      return {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        isSystemRole: updated.isSystemRole,
        permissions: permissionKeys(updated.rolePermissions),
        memberCount: updated._count.members,
      };
    });
  }

  async deleteRole(startupId: string, roleId: string) {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true, startupId: true, isSystemRole: true, _count: { select: { members: true } } },
    });
    if (!role || role.startupId !== startupId) {
      throw createError("Role not found in this startup", 404, "ROLE_NOT_FOUND");
    }
    if (role.isSystemRole) {
      throw createError("System roles can't be deleted", 403, "SYSTEM_ROLE");
    }
    if (role._count.members > 0) {
      throw createError("This role is still assigned to members — move them to another role first", 409, "ROLE_IN_USE");
    }

    await prisma.role.delete({ where: { id: roleId } });
  }

  async listMembers(startupId: string) {
    const members = await prisma.startupMember.findMany({
      where: { startupId },
      orderBy: { createdAt: "asc" },
      include: {
        role: { select: { name: true } },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    return members.map((m) => {
      const base = {
        id: m.id,
        status: m.status,
        role: m.role.name,
        joinedAt: m.joinedAt,
        createdAt: m.createdAt,
      };

      if (m.userId && m.user) {
        return {
          ...base,
          user: {
            id: m.user.id,
            firstName: m.user.firstName,
            lastName: m.user.lastName,
            email: m.user.email,
            avatarUrl: m.user.avatarUrl,
          },
        };
      }

      return {
        ...base,
        invitedEmail: m.invitedEmail,
      };
    });
  }
}

export const startupService = new StartupService();
