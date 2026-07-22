import crypto from "crypto";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { hashToken } from "../utils/auth";
import type { InviteMemberInput, AcceptInviteInput, ChangeRoleInput } from "../validators/invite.schemas";

const MEMBER_SELECT = {
  id: true,
  startupId: true,
  userId: true,
  roleId: true,
  status: true,
  invitedEmail: true,
  invitedBy: true,
  joinedAt: true,
  createdAt: true,
} as const;

const INVITE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

export class InviteService {
  async inviteMember(input: InviteMemberInput, startupId: string, inviterUserId: string) {
    const email = input.email;

    // Validate that roleId belongs to this startup (cross-startup role injection prevention)
    const role = await prisma.role.findUnique({
      where: { id: input.roleId },
      select: { id: true, startupId: true },
    });
    if (!role || role.startupId !== startupId) {
      throw createError("Role not found in this startup", 404, "ROLE_NOT_FOUND");
    }

    // Check if email already has an active or pending member row
    const existing = await prisma.startupMember.findFirst({
      where: {
        startupId,
        OR: [
          { invitedEmail: email, status: "pending" },
          { user: { email } },
        ],
      },
      select: { id: true, status: true },
    });

    if (existing) {
      throw createError("User is already a member or has a pending invitation", 409, "ALREADY_MEMBER");
    }

    // Generate cryptographically secure token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const inviteExpiresAt = new Date(Date.now() + INVITE_EXPIRATION_MS);

    // Create the pending member record (never store raw token)
    const member = await prisma.startupMember.create({
      data: {
        startupId,
        userId: null,
        roleId: input.roleId,
        status: "pending",
        invitedEmail: email,
        inviteTokenHash: tokenHash,
        inviteExpiresAt,
        invitedBy: inviterUserId,
      },
      select: MEMBER_SELECT,
    });

    return { member, rawToken, inviteExpiresAt };
  }

  async acceptInvite(input: AcceptInviteInput) {
    const tokenHash = hashToken(input.token);

    const member = await prisma.startupMember.findUnique({
      where: { inviteTokenHash: tokenHash },
      include: { startup: { select: { name: true } } },
    });

    if (!member) {
      throw createError("Invalid invitation token", 404, "INVALID_TOKEN");
    }

    if (member.inviteExpiresAt && member.inviteExpiresAt < new Date()) {
      throw createError("This invitation has expired", 410, "TOKEN_EXPIRED");
    }

    if (member.status === "active") {
      throw createError("This invitation has already been accepted", 409, "ALREADY_ACCEPTED");
    }

    const invitedEmail = member.invitedEmail;
    if (!invitedEmail) {
      throw createError("Invalid invitation", 404, "INVALID_TOKEN");
    }

    // Find a registered user by the invited email (normalized comparison)
    const user = await prisma.user.findUnique({
      where: { email: invitedEmail },
      select: { id: true, email: true },
    });

    if (!user) {
      // User is not registered yet — keep invitation pending
      return { requiresRegistration: true, email: invitedEmail };
    }

    // Activate membership
    const updatedMember = await prisma.$transaction(async (tx) => {
      const activated = await tx.startupMember.update({
        where: { id: member.id },
        data: {
          userId: user.id,
          status: "active",
          joinedAt: new Date(),
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
        select: {
          id: true,
          startupId: true,
          userId: true,
          roleId: true,
          status: true,
          joinedAt: true,
          createdAt: true,
        },
      });

      // Set this as user's active startup if they don't have one
      await tx.user.updateMany({
        where: { id: user.id, lastActiveStartupId: null },
        data: { lastActiveStartupId: activated.startupId },
      });

      return activated;
    });

    return { data: updatedMember };
  }

  async changeRole(startupId: string, memberId: string, input: ChangeRoleInput, actorMemberId: string) {
    return prisma.$transaction(async (tx) => {
      // Verify target member belongs to startup
      const target = await tx.startupMember.findUnique({
        where: { id: memberId },
        include: { role: { select: { name: true } } },
      });
      if (!target || target.startupId !== startupId) {
        throw createError("Member not found", 404, "NOT_FOUND");
      }

      // Verify new role belongs to startup
      const newRole = await tx.role.findUnique({
        where: { id: input.roleId },
        select: { id: true, startupId: true, name: true },
      });
      if (!newRole || newRole.startupId !== startupId) {
        throw createError("Role not found in this startup", 404, "ROLE_NOT_FOUND");
      }

      // Prevent demoting the last active owner
      if (target.role.name === "owner" && target.status === "active" && newRole.name !== "owner") {
        const activeOwnerCount = await tx.startupMember.count({
          where: {
            startupId,
            status: "active",
            role: { name: "owner" },
          },
        });

        if (activeOwnerCount <= 1) {
          throw createError("Cannot change the role of the last active owner", 409, "LAST_OWNER");
        }
      }

      const updated = await tx.startupMember.update({
        where: { id: memberId },
        data: { roleId: input.roleId },
        select: {
          id: true,
          startupId: true,
          userId: true,
          roleId: true,
          status: true,
          invitedEmail: true,
          invitedBy: true,
          joinedAt: true,
          createdAt: true,
        },
      });

      return { data: updated };
    });
  }

  async removeMember(startupId: string, memberId: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      // Verify target member belongs to startup
      const target = await tx.startupMember.findUnique({
        where: { id: memberId },
        include: { role: { select: { name: true } } },
      });
      if (!target || target.startupId !== startupId) {
        throw createError("Member not found", 404, "NOT_FOUND");
      }

      // Prevent removing the last active owner
      if (target.role.name === "owner" && target.status === "active") {
        const activeOwnerCount = await tx.startupMember.count({
          where: {
            startupId,
            status: "active",
            role: { name: "owner" },
          },
        });

        if (activeOwnerCount <= 1) {
          throw createError(
            "Cannot remove the last active owner",
            409,
            "LAST_OWNER",
          );
        }
      }

      // If removing self and this is their lastActiveStartupId, reset it
      if (target.userId === actorUserId) {
        await tx.user.updateMany({
          where: { id: actorUserId, lastActiveStartupId: startupId },
          data: { lastActiveStartupId: null },
        });
      }

      await tx.startupMember.delete({ where: { id: memberId } });
    });
  }

  async claimPendingInvites(email: string, userId: string, tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
    const now = new Date();

    const pendingInvites = await tx.startupMember.findMany({
      where: {
        invitedEmail: email,
        status: "pending",
        userId: null,
        inviteExpiresAt: { gt: now },
      },
    });

    if (pendingInvites.length > 0) {
      await tx.startupMember.updateMany({
        where: {
          id: { in: pendingInvites.map((i) => i.id) },
          status: "pending",
          userId: null,
          inviteExpiresAt: { gt: now },
        },
        data: {
          userId,
          status: "active",
          joinedAt: now,
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });

      // Set user's lastActiveStartupId to the first claimed startup if unset
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { lastActiveStartupId: true },
      });

      if (!user?.lastActiveStartupId && pendingInvites[0]) {
        await tx.user.update({
          where: { id: userId },
          data: { lastActiveStartupId: pendingInvites[0].startupId },
        });
      }
    }
  }
}

export const inviteService = new InviteService();