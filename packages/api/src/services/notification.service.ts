import { prisma } from "../db/prisma";
import { createError } from "../utils/errors";
import { notificationBus } from "../events/notification-bus";

/**
 * Notification types the app knows how to render. Anything else still lists,
 * with a generic icon on the client.
 */
export const NOTIFICATION_TYPES = {
  TEAM_INVITE: "team_invite",
  FOLLOWUP_DUE: "followup_due",
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
      // Already read — nothing changed, so nobody needs telling.
      return;
    }

    // Other tabs belonging to this user are showing a stale unread badge.
    notificationBus.publish(userId, { type: "notifications.changed" });
  }

  async markAllRead(userId: string) {
    const { count } = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    if (count > 0) {
      notificationBus.publish(userId, { type: "notifications.changed" });
    }

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

      const created = await prisma.notification.create({
        data: {
          userId: user.id,
          startupId: input.startupId,
          type: NOTIFICATION_TYPES.TEAM_INVITE,
          title: `You've been invited to ${input.startupName}`,
          body: `Join as ${input.roleName} to start collaborating.`,
          entityType: "startup_member",
          entityId: input.memberId,
        },
        select: { id: true, type: true, title: true, body: true },
      });

      // Reaches them immediately if they have the app open — which is the
      // whole point, since they may well be signed in already.
      notificationBus.publish(user.id, { type: "notification.created", notification: created });
    } catch (err) {
      console.error("[notifyInvitedUser] failed:", err);
    }
  }

  /** Clears the invite notification once it has been accepted or declined. */
  async clearInviteNotification(memberId: string, userId: string): Promise<void> {
    try {
      const { count } = await prisma.notification.deleteMany({
        where: {
          userId,
          type: NOTIFICATION_TYPES.TEAM_INVITE,
          entityType: "startup_member",
          entityId: memberId,
        },
      });

      if (count > 0) {
        notificationBus.publish(userId, { type: "notifications.changed" });
      }
    } catch (err) {
      console.error("[clearInviteNotification] failed:", err);
    }
  }

  /**
   * One notification per overdue follow-up, not one per day it stays
   * overdue — skips silently if this log already has one, so the daily cron
   * can run every day without duplicating what it already told someone.
   */
  async notifyFollowupDue(input: {
    userId: string;
    startupId: string;
    logId: string;
    investorName: string;
    dueDate: Date;
  }): Promise<void> {
    try {
      const existing = await prisma.notification.findFirst({
        where: {
          userId: input.userId,
          type: NOTIFICATION_TYPES.FOLLOWUP_DUE,
          entityType: "interaction_log",
          entityId: input.logId,
        },
        select: { id: true },
      });
      if (existing) return;

      const created = await prisma.notification.create({
        data: {
          userId: input.userId,
          startupId: input.startupId,
          type: NOTIFICATION_TYPES.FOLLOWUP_DUE,
          title: `Follow-up with ${input.investorName} is overdue`,
          body: `You planned to follow up by ${input.dueDate.toISOString().slice(0, 10)}.`,
          entityType: "interaction_log",
          entityId: input.logId,
        },
        select: { id: true, type: true, title: true, body: true },
      });

      notificationBus.publish(input.userId, {
        type: "notification.created",
        notification: created,
      });
    } catch (err) {
      console.error("[notifyFollowupDue] failed:", err);
    }
  }

  /**
   * Clears pending overdue-follow-up notifications once their log stops
   * being open — completed, rescheduled, or deleted. Takes a batch because
   * logging a new interaction can auto-close several older follow-ups at once.
   */
  async clearFollowupNotifications(logIds: string[]): Promise<void> {
    if (logIds.length === 0) return;
    try {
      const existing = await prisma.notification.findMany({
        where: {
          type: NOTIFICATION_TYPES.FOLLOWUP_DUE,
          entityType: "interaction_log",
          entityId: { in: logIds },
        },
        select: { id: true, userId: true },
      });
      if (existing.length === 0) return;

      await prisma.notification.deleteMany({
        where: { id: { in: existing.map((n) => n.id) } },
      });

      for (const userId of new Set(existing.map((n) => n.userId))) {
        notificationBus.publish(userId, { type: "notifications.changed" });
      }
    } catch (err) {
      console.error("[clearFollowupNotifications] failed:", err);
    }
  }
}

export const notificationService = new NotificationService();
