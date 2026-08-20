import cron from "node-cron";
import { prisma } from "../db/prisma";
import { notifyStaleLeadsAndIdleDeals } from "./pipeline-reminders";
import { notifyOverdueAndDueTodayTasks } from "./task-notifications";
import { calendarSyncQueue } from "./queue";
import { isGoogleIntegrationEnabled } from "../config/env";
import { getAiConfig } from "../config/ai";

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

  // Archived AI conversations contain user prompts and generated content.
  // Retention stays disabled until a deployment explicitly sets a policy;
  // deleting the session cascades its messages, citations, tools and artifacts.
  const chatRetentionDays = getAiConfig().chatRetentionDays;
  if (chatRetentionDays > 0) {
    cron.schedule("15 3 * * *", async () => {
      try {
        const cutoff = new Date(Date.now() - chatRetentionDays * 24 * 60 * 60 * 1_000);
        const { count } = await prisma.aiChatSession.deleteMany({
          where: { archivedAt: { not: null, lt: cutoff } },
        });
        if (count > 0) console.info(`[cron] Deleted ${count} AI chat session(s) past retention`);
      } catch (err) {
        console.error("[cron] Failed to enforce AI chat retention:", err);
      }
    });
  }

  // Once a day is enough notifyOverdueAndDueTodayTasks skips tasks it has
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

  // Document uploads are two-phase: createUploadSession makes the Document +
  // DocumentVersion row before the browser has sent a single byte, and only
  // confirm() moves it out of pending_upload. If the tab closes, the network
  // drops, or the user just gives up mid-upload, nothing else ever revisits
  // that row it would otherwise show as "Uploading…" forever. An hour is far
  // longer than any real upload on this size cap should take.
  cron.schedule("*/30 * * * *", async () => {
    try {
      const staleCutoff = new Date(Date.now() - 60 * 60 * 1000);
      const { count: versionCount } = await prisma.documentVersion.deleteMany({
        where: { processingStatus: "pending_upload", createdAt: { lt: staleCutoff } },
      });
      // A Document whose only version never finished uploading is left with
      // none once the row above is gone; nothing else will ever reference it.
      const { count: documentCount } = await prisma.document.deleteMany({
        where: { createdAt: { lt: staleCutoff }, versions: { none: {} } },
      });
      if (versionCount > 0 || documentCount > 0) {
        console.info(
          `[cron] Cleaned up ${versionCount} stale pending upload(s) and ${documentCount} orphaned document(s)`,
        );
      }
    } catch (err) {
      console.error("[cron] Failed to clean up stale document uploads:", err);
    }
  });

  // Every 30 minutes rather than once a day like the reminders above a
  // meeting is only useful on an investor's timeline soon after it happens,
  // not the next morning. Skipped entirely when the integration isn't
  // configured, so an unconfigured deployment isn't polling Google for nothing.
  if (isGoogleIntegrationEnabled()) {
    cron.schedule("*/30 * * * *", async () => {
      try {
        const connections = await prisma.googleConnection.findMany({
          where: { status: "active", calendarSyncEnabled: true },
          select: { userId: true },
        });
        for (const { userId } of connections) {
          // jobId dedupes: if the previous cycle's sync for this user is still
          // running, BullMQ reuses the in-flight job instead of stacking a
          // second one on top of it.
          await calendarSyncQueue.add(
            "calendar-sync",
            { userId },
            { jobId: `calendar-sync:${userId}` },
          );
        }
      } catch (err) {
        console.error("[cron] Failed to enqueue calendar sync:", err);
      }
    });
  }

  console.info("Cron jobs scheduled");
}
