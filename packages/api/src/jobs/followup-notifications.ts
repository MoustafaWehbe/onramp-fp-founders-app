import { prisma } from "../db/prisma";
import { notificationService } from "../services/notification.service";

/**
 * Finds every open follow-up whose date has passed and notifies whoever set
 * it. The Pipeline board's Focus list only surfaces this to someone who
 * opens that page — without this, an overdue follow-up can sit unnoticed
 * indefinitely. Safe to run repeatedly: notifyFollowupDue is a no-op for a
 * log that already has one.
 */
export async function notifyOverdueFollowups(): Promise<void> {
  const overdue = await prisma.interactionLog.findMany({
    where: {
      followupCompletedAt: null,
      nextFollowupDate: { not: null, lt: new Date() },
    },
    select: {
      id: true,
      createdBy: true,
      nextFollowupDate: true,
      startupInvestor: { select: { fullName: true, startupId: true } },
    },
  });

  for (const log of overdue) {
    await notificationService.notifyFollowupDue({
      userId: log.createdBy,
      startupId: log.startupInvestor.startupId,
      logId: log.id,
      investorName: log.startupInvestor.fullName,
      dueDate: log.nextFollowupDate as Date,
    });
  }
}
