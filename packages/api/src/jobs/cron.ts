import cron from "node-cron";
import { prisma } from "../db/prisma";
import { notifyStaleLeadsAndIdleDeals } from "./pipeline-reminders";
import { notifyOverdueAndDueTodayTasks } from "./task-notifications";

export function startCronJobs(): void {
  // Delete expired pending registrations every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    try {
      const { count } = await prisma.pendingRegistration.deleteMany({
        where: { otpExpiresAt: { lt: new Date() } },
      });
      if (count > 0) console.info(`[cron] Deleted ${count} expired pending registration(s)`);
    } catch (err) {
      console.error("[cron] Failed to clean up pending registrations:", err);
    }
  });

  // Once a day is enough — notifyOverdueAndDueTodayTasks skips tasks it has
  // already notified about, so a missed or re-run tick never duplicates a
  // notice. (The follow-up equivalent used to run here too; tasks replaced
  // it, and nothing writes a follow-up date any more.)
  cron.schedule("0 9 * * *", async () => {
    try {
      await notifyOverdueAndDueTodayTasks();
    } catch (err) {
      console.error("[cron] Failed to notify overdue/due-today tasks:", err);
    }

    // Deliberately after the task pass and in its own try: a deal reminder is
    // less urgent than a dated task, and neither may take the other down.
    try {
      await notifyStaleLeadsAndIdleDeals();
    } catch (err) {
      console.error("[cron] Failed to notify stale leads / deals without a next step:", err);
    }
  });

  console.info("Cron jobs scheduled");
}
