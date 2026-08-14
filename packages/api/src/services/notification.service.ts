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
  TASK_OVERDUE: "task_overdue",
  TASK_DUE_TODAY: "task_due_today",
  TASK_ASSIGNED: "task_assigned",
  LEAD_STALE: "lead_stale",
  DEAL_NO_NEXT_STEP: "deal_no_next_step",
} as const;

/**
 * How long a deal reminder suppresses the next one for the same deal. Unlike
 * an overdue task, a quiet lead never "completes" — it simply stays quiet — so
 * these cannot dedupe on the entity forever or a deal that goes cold again in
 * three months would never be mentioned twice.
 */
const DEAL_REMINDER_COOLDOWN_DAYS = 7;

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

  /**
   * One notification per overdue task, not one per day it stays overdue —
   * skips silently if this task already has one, so the daily cron can run
   * every day without duplicating what it already told someone.
   */
  async notifyTaskOverdue(input: {
    userId: string;
    startupId: string;
    taskId: string;
    title: string;
    dueDate: Date;
  }): Promise<void> {
    await this.notifyTask(NOTIFICATION_TYPES.TASK_OVERDUE, {
      ...input,
      body: `Was due ${input.dueDate.toISOString().slice(0, 10)}.`,
      titlePrefix: "Task overdue",
    });
  }

  /** Same idempotency as notifyTaskOverdue, for a task due today rather than in the past. */
  async notifyTaskDueToday(input: {
    userId: string;
    startupId: string;
    taskId: string;
    title: string;
    dueDate: Date;
  }): Promise<void> {
    await this.notifyTask(NOTIFICATION_TYPES.TASK_DUE_TODAY, {
      ...input,
      body: "Due today.",
      titlePrefix: "Task due today",
    });
  }

  /**
   * Tells someone a task is now theirs, at the moment it is assigned.
   * Without this the only word they get is the overdue/due-today cron, so a
   * task handed over three weeks ahead of its date stays invisible until the
   * morning it is already due.
   *
   * Not deduped on entity like the date-driven ones: being reassigned a task
   * you once held is genuinely new information each time.
   */
  async notifyTaskAssigned(input: {
    userId: string;
    startupId: string;
    taskId: string;
    title: string;
    dueDate: Date | null;
    assignedByName?: string | null;
  }): Promise<void> {
    try {
      const due = input.dueDate ? ` Due ${input.dueDate.toISOString().slice(0, 10)}.` : "";
      const by = input.assignedByName ? `${input.assignedByName} assigned this to you.` : "This is now yours.";

      const created = await prisma.notification.create({
        data: {
          userId: input.userId,
          startupId: input.startupId,
          type: NOTIFICATION_TYPES.TASK_ASSIGNED,
          title: `New task: ${input.title}`,
          body: `${by}${due}`,
          entityType: "task",
          entityId: input.taskId,
        },
        select: { id: true, type: true, title: true, body: true },
      });

      notificationBus.publish(input.userId, {
        type: "notification.created",
        notification: created,
      });
    } catch (err) {
      console.error("[notifyTaskAssigned] failed:", err);
    }
  }

  /**
   * A lead investor who has gone quiet. A priced round does not happen
   * without its lead, so this is the one deal whose silence is worth
   * interrupting someone over.
   */
  async notifyLeadStale(input: {
    userId: string;
    startupId: string;
    pipelineId: string;
    investorName: string;
    daysQuiet: number;
  }): Promise<void> {
    await this.notifyDeal(NOTIFICATION_TYPES.LEAD_STALE, {
      userId: input.userId,
      startupId: input.startupId,
      pipelineId: input.pipelineId,
      title: `Lead investor ${input.investorName} has gone quiet`,
      body: `No contact logged in ${input.daysQuiet} days. Set the next step before the round loses its anchor.`,
    });
  }

  /** A live deal nobody has given a next step — the quiet way a raise stalls. */
  async notifyDealNoNextStep(input: {
    userId: string;
    startupId: string;
    pipelineId: string;
    investorName: string;
  }): Promise<void> {
    await this.notifyDeal(NOTIFICATION_TYPES.DEAL_NO_NEXT_STEP, {
      userId: input.userId,
      startupId: input.startupId,
      pipelineId: input.pipelineId,
      title: `${input.investorName} has no next step`,
      body: "This deal is live with no open task. Add one so it does not go cold.",
    });
  }

  private async notifyDeal(
    type: (typeof NOTIFICATION_TYPES)["LEAD_STALE"] | (typeof NOTIFICATION_TYPES)["DEAL_NO_NEXT_STEP"],
    input: { userId: string; startupId: string; pipelineId: string; title: string; body: string },
  ): Promise<void> {
    try {
      const cooldownStart = new Date(
        Date.now() - DEAL_REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
      );
      const recent = await prisma.notification.findFirst({
        where: {
          userId: input.userId,
          type,
          entityType: "pipeline",
          entityId: input.pipelineId,
          createdAt: { gte: cooldownStart },
        },
        select: { id: true },
      });
      if (recent) return;

      const created = await prisma.notification.create({
        data: {
          userId: input.userId,
          startupId: input.startupId,
          type,
          title: input.title,
          body: input.body,
          entityType: "pipeline",
          entityId: input.pipelineId,
        },
        select: { id: true, type: true, title: true, body: true },
      });

      notificationBus.publish(input.userId, {
        type: "notification.created",
        notification: created,
      });
    } catch (err) {
      console.error("[notifyDeal] failed:", err);
    }
  }

  private async notifyTask(
    type: (typeof NOTIFICATION_TYPES)["TASK_OVERDUE"] | (typeof NOTIFICATION_TYPES)["TASK_DUE_TODAY"],
    input: { userId: string; startupId: string; taskId: string; title: string; body: string; titlePrefix: string },
  ): Promise<void> {
    try {
      const existing = await prisma.notification.findFirst({
        where: { userId: input.userId, type, entityType: "task", entityId: input.taskId },
        select: { id: true },
      });
      if (existing) return;

      const created = await prisma.notification.create({
        data: {
          userId: input.userId,
          startupId: input.startupId,
          type,
          title: `${input.titlePrefix}: ${input.title}`,
          body: input.body,
          entityType: "task",
          entityId: input.taskId,
        },
        select: { id: true, type: true, title: true, body: true },
      });

      notificationBus.publish(input.userId, {
        type: "notification.created",
        notification: created,
      });
    } catch (err) {
      console.error("[notifyTask] failed:", err);
    }
  }

  /**
   * Clears pending overdue/due-today notifications once their task stops
   * being open — completed, reopened, rescheduled, or deleted.
   */
  async clearTaskNotifications(taskIds: string[]): Promise<void> {
    if (taskIds.length === 0) return;
    try {
      const existing = await prisma.notification.findMany({
        where: {
          type: { in: [NOTIFICATION_TYPES.TASK_OVERDUE, NOTIFICATION_TYPES.TASK_DUE_TODAY] },
          entityType: "task",
          entityId: { in: taskIds },
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
      console.error("[clearTaskNotifications] failed:", err);
    }
  }
}

export const notificationService = new NotificationService();
