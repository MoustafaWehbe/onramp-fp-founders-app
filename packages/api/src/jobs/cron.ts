import cron from "node-cron";
import { prisma } from "../db/prisma";
import { notifyOverdueFollowups } from "./followup-notifications";

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

  // Once a day is enough — notifyOverdueFollowups skips logs it already
  // notified about, so a missed or re-run tick never duplicates a notice.
  cron.schedule("0 9 * * *", async () => {
    try {
      await notifyOverdueFollowups();
    } catch (err) {
      console.error("[cron] Failed to notify overdue follow-ups:", err);
    }
  });

  console.info("Cron jobs scheduled");
}
