import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";

/**
 * Notification types the app knows how to render. Anything else still lists,
 * with a generic icon on the client.
 */
export const NOTIFICATION_TYPES = {
  TEAM_INVITE: "team_invite",
} as const;

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  entityType: true,
  entityId: true,
  readAt: true,
  createdAt: true,
  startup: { select: { id: true, name: true } },
} as const;

export class NotificationService {
  /**
   * Notifications belong to a user, not to a workspace — someone who has been
   * invited but has not joined anything yet still needs to see the invitation
   * sitting on their otherwise empty dashboard.
   */
  async list(userId: string, options: { limit: number; unreadOnly: boolean }) {
    const where = {
      userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
    };

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        select: NOTIFICATION_SELECT,
        orderBy: { createdAt: "desc" },
        take: options.limit,
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return { items, unreadCount };
  }

  async markRead(id: string, userId: string) {
    // Scoping the update by userId means another user's id simply matches
    // nothing, rather than leaking whether it exists.
    const updated = await prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });

    if (updated.count === 0) {
      const exists = await prisma.notification.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!exists) {
        throw createError("Notification not found", 404, "NOT_FOUND");
      }
    }
  }

  async markAllRead(userId: string) {
    const { count } = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }

  /**
   * Records a notification, if the address belongs to a registered user.
   *
   * Invitations go to an email that may not have an account yet; there is
   * nobody to notify in that case and the emailed link is the only channel.
   * Never throws — a notification is an extra, and losing one must not fail the
   * action that produced it.
   */
  async notifyInvitedUser(input: {
    email: string;
    startupId: string;
    startupName: string;
    roleName: string;
    memberId: string;
  }): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (!user) return;

      await prisma.notification.create({
        data: {
          userId: user.id,
          startupId: input.startupId,
          type: NOTIFICATION_TYPES.TEAM_INVITE,
          title: `You've been invited to ${input.startupName}`,
          body: `Join as ${input.roleName} to start collaborating.`,
          entityType: "startup_member",
          entityId: input.memberId,
        },
      });
    } catch (err) {
      console.error("[notifyInvitedUser] failed:", err);
    }
  }

  /** Clears the invite notification once it has been accepted or declined. */
  async clearInviteNotification(memberId: string, userId: string): Promise<void> {
    try {
      await prisma.notification.deleteMany({
        where: {
          userId,
          type: NOTIFICATION_TYPES.TEAM_INVITE,
          entityType: "startup_member",
          entityId: memberId,
        },
      });
    } catch (err) {
      console.error("[clearInviteNotification] failed:", err);
    }
  }
}

export const notificationService = new NotificationService();
