import { prisma } from "../db/prisma";
import type { CreateStartupInput } from "../validators/startup.schemas";
import { ROLE_DEFINITIONS, ROLE_TEMPLATES } from "../config/permissions";

export class StartupService {
  async createStartup(input: CreateStartupInput, userId: string) {
    return prisma.$transaction(async (tx) => {
      // 1. Create the startup
      const startup = await tx.startup.create({
        data: {
          name: input.name,
          description: input.description,
          industry: input.industry,
          website: input.website ?? null,
          fundingStage: input.funding_stage ?? null,
          createdBy: userId,
        },
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

        const permRows = keys
          .map((k) => byKey.get(k))
          .filter((p): p is NonNullable<typeof p> => p != null)
          .map((p) => ({ roleId: role.id, permissionId: p.id }));

        if (permRows.length > 0) {
          await tx.rolePermission.createMany({ data: permRows });
        }
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
}

export const startupService = new StartupService();
