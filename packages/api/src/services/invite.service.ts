import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { hashToken } from "../utils/auth";
import type { InviteMemberInput, AcceptInviteInput, ChangeRoleInput } from "../validators/invite.schemas";

type Db = typeof prisma | Prisma.TransactionClient;

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

const ACCEPTED_MEMBER_SELECT = {
  id: true,
  startupId: true,
  userId: true,
  roleId: true,
  status: true,
  joinedAt: true,
  createdAt: true,
} as const;

type AcceptedMember = { [K in keyof typeof ACCEPTED_MEMBER_SELECT]: unknown };

/** Narrows an already-loaded row to the fields the accept response exposes. */
function toAcceptedMember<T extends AcceptedMember>(member: T) {
  return {
    id: member.id,
    startupId: member.startupId,
    userId: member.userId,
    roleId: member.roleId,
    status: member.status,
    joinedAt: member.joinedAt,
    createdAt: member.createdAt,
  } as Pick<T, keyof typeof ACCEPTED_MEMBER_SELECT>;
}

const INVITE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

export class InviteService {
  async inviteMember(input: InviteMemberInput, startupId: string, inviterUserId: string, actorMemberId: string) {
    const email = input.email;

    // Validate that roleId belongs to this startup (cross-startup role injection prevention)
    const role = await prisma.role.findUnique({
      where: { id: input.roleId },
      select: { id: true, startupId: true, name: true },
    });
    if (!role || role.startupId !== startupId) {
      throw createError("Role not found in this startup", 404, "ROLE_NOT_FOUND");
    }

    if (role.name === "owner") {
      await this.assertActorIsOwner(prisma, actorMemberId, startupId);
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

    return { member, rawToken, inviteExpiresAt, roleName: role.name };
  }

  /**
   * Issues a fresh token for a still-pending invitation and restarts its 7-day
   * clock. Only the hash of the original is stored, so the old link cannot be
   * re-sent — it is replaced, and any copy already in someone's inbox stops
   * working.
   */
  async resendInvite(startupId: string, memberId: string) {
    const member = await prisma.startupMember.findUnique({
      where: { id: memberId },
      select: { id: true, startupId: true, status: true, invitedEmail: true },
    });

    if (!member || member.startupId !== startupId) {
      throw createError("Member not found", 404, "NOT_FOUND");
    }

    if (member.status !== "pending" || !member.invitedEmail) {
      throw createError(
        "This invitation has already been accepted",
        409,
        "ALREADY_ACCEPTED",
      );
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const inviteExpiresAt = new Date(Date.now() + INVITE_EXPIRATION_MS);

    await prisma.startupMember.update({
      where: { id: memberId },
      data: { inviteTokenHash: hashToken(rawToken), inviteExpiresAt },
    });

    return { rawToken, email: member.invitedEmail, inviteExpiresAt };
  }

  /**
   * Accepting an invitation is an act by the invited person, not by whoever
   * happens to hold the link. `viewerUserId` is the signed-in user, or null
   * when nobody is signed in; nothing is mutated until the two are known to
   * match, so a forwarded link cannot join someone else to a workspace.
   */
  async acceptInvite(input: AcceptInviteInput, viewerUserId: string | null) {
    const tokenHash = hashToken(input.token);

    const member = await prisma.startupMember.findUnique({
      where: { inviteTokenHash: tokenHash },
      include: { startup: { select: { name: true } } },
    });

    if (!member) {
      throw createError("Invalid invitation token", 404, "INVALID_TOKEN");
    }

    // Accepting is idempotent for the person it belongs to. The link survives
    // activation precisely so that opening it a second time — or opening it
    // after registration already claimed the invite — says "you're in" rather
    // than "invalid link".
    if (member.status === "active") {
      if (viewerUserId && member.userId === viewerUserId) {
        return { data: toAcceptedMember(member) };
      }
      throw createError("This invitation has already been accepted", 409, "ALREADY_ACCEPTED");
    }

    if (member.inviteExpiresAt && member.inviteExpiresAt < new Date()) {
      throw createError("This invitation has expired", 410, "TOKEN_EXPIRED");
    }

    const invitedEmail = member.invitedEmail;
    if (!invitedEmail) {
      throw createError("Invalid invitation", 404, "INVALID_TOKEN");
    }

    if (!viewerUserId) {
      // Whether an account already exists decides where we send them, but the
      // invitation stays pending either way.
      const registered = await prisma.user.findUnique({
        where: { email: invitedEmail },
        select: { id: true },
      });

      return registered
        ? { requiresLogin: true as const, email: invitedEmail }
        : { requiresRegistration: true as const, email: invitedEmail };
    }

    // Read the address from the database rather than the access token, which
    // may predate an email change.
    const viewer = await prisma.user.findUnique({
      where: { id: viewerUserId },
      select: { id: true, email: true },
    });

    if (!viewer) {
      throw createError("Authentication required", 401, "AUTH_REQUIRED");
    }

    if (viewer.email.toLowerCase() !== invitedEmail.toLowerCase()) {
      return { emailMismatch: true as const, invitedEmail, signedInAs: viewer.email };
    }

    return { data: await this.activateMembership(member.id, viewer.id) };
  }

  /**
   * Flips a pending row to active for `userId`. Callers are responsible for
   * having established that the row belongs to that person.
   */
  private async activateMembership(memberId: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      // Re-check status inside the transaction so two concurrent accepts cannot
      // both activate — the second finds nothing pending and bails.
      const claimed = await tx.startupMember.updateMany({
        where: { id: memberId, status: "pending" },
        data: {
          userId,
          status: "active",
          joinedAt: new Date(),
          inviteExpiresAt: null,
        },
      });

      if (claimed.count === 0) {
        throw createError("This invitation has already been accepted", 409, "ALREADY_ACCEPTED");
      }

      const activated = await tx.startupMember.findUniqueOrThrow({
        where: { id: memberId },
        select: ACCEPTED_MEMBER_SELECT,
      });

      // Set this as user's active startup if they don't have one
      await tx.user.updateMany({
        where: { id: userId, lastActiveStartupId: null },
        data: { lastActiveStartupId: activated.startupId },
      });

      return activated;
    });
  }

  /**
   * Invitations waiting for the signed-in user, so someone who was already
   * logged in when the invite arrived can accept it from inside the app instead
   * of having to dig the link out of their email.
   */
  async listMyInvites(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) return [];

    const invites = await prisma.startupMember.findMany({
      where: {
        invitedEmail: user.email,
        status: "pending",
        userId: null,
        inviteExpiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        createdAt: true,
        inviteExpiresAt: true,
        startup: { select: { id: true, name: true, industry: true, fundingStage: true } },
        role: { select: { id: true, name: true } },
        inviter: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return invites;
  }

  /**
   * Accepts by membership id rather than token — the caller proved who they are
   * with their session, so no secret from the email is needed.
   */
  async acceptMyInvite(memberId: string, userId: string) {
    const member = await this.findMyPendingInvite(memberId, userId);
    return this.activateMembership(member.id, userId);
  }

  /** Turning an invitation down removes it; the owner may send a new one. */
  async declineMyInvite(memberId: string, userId: string) {
    const member = await this.findMyPendingInvite(memberId, userId);
    await prisma.startupMember.deleteMany({ where: { id: member.id, status: "pending" } });
  }

  private async findMyPendingInvite(memberId: string, userId: string) {
    const [member, user] = await Promise.all([
      prisma.startupMember.findUnique({
        where: { id: memberId },
        select: { id: true, status: true, invitedEmail: true, inviteExpiresAt: true },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);

    // A membership addressed to somebody else is reported as missing rather
    // than forbidden: the caller has no business knowing it exists.
    if (
      !member ||
      !user ||
      !member.invitedEmail ||
      member.invitedEmail.toLowerCase() !== user.email.toLowerCase()
    ) {
      throw createError("Invitation not found", 404, "NOT_FOUND");
    }

    if (member.status !== "pending") {
      throw createError("This invitation has already been accepted", 409, "ALREADY_ACCEPTED");
    }

    if (member.inviteExpiresAt && member.inviteExpiresAt < new Date()) {
      throw createError("This invitation has expired", 410, "TOKEN_EXPIRED");
    }

    return member;
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

      if (newRole.name === "owner") {
        await this.assertActorIsOwner(tx, actorMemberId, startupId);
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

  // Helper to assert that the actor is an active owner of the startup
  private async assertActorIsOwner(db: Db, actorMemberId: string, startupId: string): Promise<void> {
    const actor = await db.startupMember.findUnique({
      where: { id: actorMemberId },
      include: { role: { select: { name: true } } },
    });

    if (!actor || actor.startupId !== startupId || actor.status !== "active" || actor.role.name !== "owner") {
      throw createError("Only owners can assign the owner role", 403, "OWNER_ONLY");
    }
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
      orderBy: { createdAt: "asc" },
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
          // The hash stays put so the link already sitting in their inbox
          // resolves to "you're in" instead of "invalid invitation".
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