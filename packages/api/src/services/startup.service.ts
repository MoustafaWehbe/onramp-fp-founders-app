import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import type { CreateStartupInput, UpdateStartupInput } from "../validators/startup.schemas";
import { ROLE_DEFINITIONS, ROLE_TEMPLATES } from "../config/permissions";

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
        role: { select: { name: true } },
        startup: { select: STARTUP_SELECT },
      },
    });

    return memberships.map((m) => ({
      ...m.startup,
      member: {
        id: m.id,
        status: m.status,
        role: m.role.name,
        joinedAt: m.joinedAt,
      },
    }));
  }

  async getStartup(startupId: string, userId: string) {
    const startup = await prisma.startup.findUnique({
      where: { id: startupId },
      select: STARTUP_SELECT,
    });
    if (!startup) throw createError("Startup not found", 404, "NOT_FOUND");

    const membership = await prisma.startupMember.findUnique({
      where: { startupId_userId: { startupId, userId } },
      include: { role: { select: { name: true } } },
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
    return prisma.role.findMany({
      where: { startupId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        isSystemRole: true,
      },
    });
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
