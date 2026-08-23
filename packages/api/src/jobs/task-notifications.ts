import { prisma } from "../db/prisma";
import { NOTIFICATION_TYPES, notificationService } from "../services/notification.service";

/**
 * Finds every open task that is overdue or due today and notifies its
 * assignee. Safe to run repeatedly, since
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
  const candidates = dueTasks
    .filter((task): task is typeof task & { assignee: { userId: string } } => Boolean(task.assignee?.userId))
    .map((task) => {
      const dueDate = task.dueDate as Date;
      const type = dueDate.getTime() < now ? NOTIFICATION_TYPES.TASK_OVERDUE : NOTIFICATION_TYPES.TASK_DUE_TODAY;
      return { task, dueDate, type };
    });
  if (candidates.length === 0) return;

  // notifyTaskOverdue/notifyTaskDueToday already dedupe forever per task
  // (findFirst then create, under an advisory lock see notification.service.ts),
  // but that check ran once per task, serially, every single cron tick even
  // for tasks that plainly already have their notification. This batches that
  // same "already told them" question into one query so only tasks that might
  // actually need a new notification pay for the per-task lock+transaction.
  const alreadyNotified = await prisma.notification.findMany({
    where: {
      type: { in: [NOTIFICATION_TYPES.TASK_OVERDUE, NOTIFICATION_TYPES.TASK_DUE_TODAY] },
      entityType: "task",
      entityId: { in: candidates.map((candidate) => candidate.task.id) },
    },
    select: { type: true, entityId: true },
  });
  const notified = new Set(alreadyNotified.map((n) => `${n.type}:${n.entityId}`));

  await Promise.all(
    candidates
      .filter((candidate) => !notified.has(`${candidate.type}:${candidate.task.id}`))
      .map((candidate) => {
        const { task, dueDate, type } = candidate;
        const input = { userId: task.assignee.userId, startupId: task.startupId, taskId: task.id, title: task.title, dueDate };
        return type === NOTIFICATION_TYPES.TASK_OVERDUE
          ? notificationService.notifyTaskOverdue(input)
          : notificationService.notifyTaskDueToday(input);
      }),
  );
}
