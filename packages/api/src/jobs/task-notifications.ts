import { prisma } from "../db/prisma";
import { notificationService } from "../services/notification.service";

/**
 * Finds every open task that is overdue or due today and notifies its
 * assignee. Mirrors notifyOverdueFollowups: safe to run repeatedly, since
 * notifyTaskOverdue/notifyTaskDueToday are no-ops for a task that already has
 * one. A task with no assignee, or whose assignee is a pending invite with
 * no account yet, has nobody to notify and is skipped.
 */
export async function notifyOverdueAndDueTodayTasks(): Promise<void> {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const dueTasks = await prisma.task.findMany({
    where: {
      status: "open",
      dueDate: { not: null, lte: endOfToday },
    },
    select: {
      id: true,
      startupId: true,
      title: true,
      dueDate: true,
      assignee: { select: { userId: true } },
    },
  });

  const now = Date.now();
  for (const task of dueTasks) {
    const userId = task.assignee?.userId;
    if (!userId) continue;

    const dueDate = task.dueDate as Date;
    if (dueDate.getTime() < now) {
      await notificationService.notifyTaskOverdue({
        userId,
        startupId: task.startupId,
        taskId: task.id,
        title: task.title,
        dueDate,
      });
    } else {
      await notificationService.notifyTaskDueToday({
        userId,
        startupId: task.startupId,
        taskId: task.id,
        title: task.title,
        dueDate,
      });
    }
  }
}
