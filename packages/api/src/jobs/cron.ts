import cron from "node-cron";
import { prisma } from "../db/prisma";

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

  console.info("Cron jobs scheduled");
}
