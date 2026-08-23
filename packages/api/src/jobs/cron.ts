import cron from "node-cron";
import { prisma } from "../db/prisma";
import { notifyStaleLeadsAndIdleDeals } from "./pipeline-reminders";
import { notifyOverdueAndDueTodayTasks } from "./task-notifications";
import { calendarSyncQueue } from "./queue";
import { getRedis } from "../db/redis";
import { isGoogleIntegrationEnabled } from "../config/env";
import { getAiConfig } from "../config/ai";
import { logger } from "../utils/logger";
import type { ScheduledTask } from "node-cron";
import { enforceReviewerRetention } from "./reviewer-retention";
import { recordReviewerRetentionRun } from "../observability/reviewer-metrics";

/**
 * startCronJobs() runs once per API process, and the API is horizontally
 * scaled (see docker-compose.yml / Dockerfile.worker) with no leader
 * election, so every replica's node-cron fires every schedule independently.
 * This closes that gap with a Redis lock keyed to the schedule's own
 * interval, bucketed by wall-clock time so every replica computes the same
 * key for the same logical tick regardless of which one's clock fires first
 * only the replica that wins the SET NX for that tick actually runs the body;
 * the rest see the lock already held and skip. The lock expires with the
 * bucket, so a crash mid-run never blocks the next legitimate tick.
 */
async function withCronLock(name: string, intervalMs: number, fn: () => Promise<void>): Promise<void> {
  const bucket = Math.floor(Date.now() / intervalMs);
  const acquired = await getRedis().set(`cron-lock:${name}:${bucket}`, "1", "PX", intervalMs, "NX");
  if (!acquired) return;
  await fn();
}

const THIRTY_MINUTES_MS = 30 * 60 * 1_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

export function startCronJobs(): ScheduledTask[] {
  // Delete expired pending registrations every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    await withCronLock("pending-registration-cleanup", THIRTY_MINUTES_MS, async () => {
      try {
        const { count } = await prisma.pendingRegistration.deleteMany({
          where: { otpExpiresAt: { lt: new Date() } },
        });
        if (count > 0) logger.info({ count }, "[cron] Deleted expired pending registration(s)");
      } catch (err) {
        logger.error({ err }, "[cron] Failed to clean up pending registrations");
      }
    });
  });

  // Archived AI conversations contain user prompts and generated content.
  // Retention stays disabled until a deployment explicitly sets a policy;
  // deleting the session cascades its messages, citations, tools and artifacts.
  const chatRetentionDays = getAiConfig().chatRetentionDays;
  if (chatRetentionDays > 0) {
    cron.schedule("15 3 * * *", async () => {
      await withCronLock("ai-chat-retention", ONE_DAY_MS, async () => {
        try {
          const cutoff = new Date(Date.now() - chatRetentionDays * 24 * 60 * 60 * 1_000);
          const { count } = await prisma.aiChatSession.deleteMany({
            where: { archivedAt: { not: null, lt: cutoff } },
          });
          if (count > 0) logger.info({ count }, "[cron] Deleted AI chat session(s) past retention");
        } catch (err) {
          logger.error({ err }, "[cron] Failed to enforce AI chat retention");
        }
      });
    });
  }

  // Reviewer access creates short-lived credentials and privacy-sensitive
  // network/device signals. Keep durable founder-facing comments and aggregate
  // visit results, but enforce the narrower retention windows every day.
  cron.schedule("45 3 * * *", async () => {
    await withCronLock("reviewer-data-retention", ONE_DAY_MS, async () => {
      try {
        const result = await enforceReviewerRetention();
        recordReviewerRetentionRun("success", result);
        logger.info(
          { event: "reviewer_retention_completed", ...result },
          "[cron] Enforced reviewer data retention",
        );
      } catch (err) {
        recordReviewerRetentionRun("error");
        logger.error(
          { err, event: "reviewer_retention_failed" },
          "[cron] Failed to enforce reviewer data retention",
        );
      }
    });
  });

  // Once a day is enough notifyOverdueAndDueTodayTasks skips tasks it has
  // already notified about, so a missed or re-run tick never duplicates a
  // notice. (The follow-up equivalent used to run here too; tasks replaced
  // it, and nothing writes a follow-up date any more.)
  cron.schedule("0 9 * * *", async () => {
    await withCronLock("daily-reminders", ONE_DAY_MS, async () => {
      try {
        await notifyOverdueAndDueTodayTasks();
      } catch (err) {
        logger.error({ err }, "[cron] Failed to notify overdue/due-today tasks");
      }

      // Deliberately after the task pass and in its own try: a deal reminder is
      // less urgent than a dated task, and neither may take the other down.
      try {
        await notifyStaleLeadsAndIdleDeals();
      } catch (err) {
        logger.error({ err }, "[cron] Failed to notify stale leads / deals without a next step");
      }
    });
  });

  // Document uploads are two-phase: createUploadSession makes the Document +
  // DocumentVersion row before the browser has sent a single byte, and only
  // confirm() moves it out of pending_upload. If the tab closes, the network
  // drops, or the user just gives up mid-upload, nothing else ever revisits
  // that row it would otherwise show as "Uploading…" forever. An hour is far
  // longer than any real upload on this size cap should take.
  cron.schedule("*/30 * * * *", async () => {
    await withCronLock("stale-document-upload-cleanup", THIRTY_MINUTES_MS, async () => {
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
          logger.info(
            { versionCount, documentCount },
            "[cron] Cleaned up stale pending upload(s) and orphaned document(s)",
          );
        }
      } catch (err) {
        logger.error({ err }, "[cron] Failed to clean up stale document uploads");
      }
    });
  });

  // Every 30 minutes rather than once a day like the reminders above a
  // meeting is only useful on an investor's timeline soon after it happens,
  // not the next morning. Skipped entirely when the integration isn't
  // configured, so an unconfigured deployment isn't polling Google for nothing.
  if (isGoogleIntegrationEnabled()) {
    cron.schedule("*/30 * * * *", async () => {
      await withCronLock("calendar-sync-enqueue", THIRTY_MINUTES_MS, async () => {
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
          logger.error({ err }, "[cron] Failed to enqueue calendar sync");
        }
      });
    });
  }

  logger.info("Cron jobs scheduled");
  return [...cron.getTasks().values()];
}
