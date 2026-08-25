import type { Job } from "bullmq";
import { JOB_NAMES } from "../job-names";
import { calendarSyncQueue, scheduledTasksQueue } from "../queue";
import { notifyStaleLeadsAndIdleDeals } from "../pipeline-reminders";
import { notifyOverdueAndDueTodayTasks } from "../task-notifications";
import { enforceReviewerRetention } from "../reviewer-retention";
import { recordReviewerRetentionRun } from "../../observability/reviewer-metrics";
import { prisma } from "../../db/prisma";
import { getAiConfig } from "../../config/ai";
import { isGoogleIntegrationEnabled } from "../../config/env";
import { logger } from "../../utils/logger";

export type ScheduledTaskJobData = Record<string, never>;

/**
 * Job names within the scheduledTasks queue — previously each was its own
 * node-cron schedule plus a Redis SET NX bucket lock (see git history for
 * withCronLock) to stop every API replica's cron from firing it
 * independently. A BullMQ repeatable job needs none of that: Redis is where
 * the schedule itself lives, so exactly one job instance is produced per due
 * tick regardless of replica count, and only one worker instance ever claims
 * it.
 */
export const SCHEDULED_TASK_NAMES = {
  pendingRegistrationCleanup: "pending-registration-cleanup",
  aiChatRetention: "ai-chat-retention",
  reviewerDataRetention: "reviewer-data-retention",
  dailyReminders: "daily-reminders",
  staleDocumentUploadCleanup: "stale-document-upload-cleanup",
  calendarSyncEnqueue: "calendar-sync-enqueue",
} as const;

async function pendingRegistrationCleanup(): Promise<void> {
  try {
    const { count } = await prisma.pendingRegistration.deleteMany({
      where: { otpExpiresAt: { lt: new Date() } },
    });
    if (count > 0) logger.info({ count }, "[scheduled-tasks] Deleted expired pending registration(s)");
  } catch (err) {
    logger.error({ err }, "[scheduled-tasks] Failed to clean up pending registrations");
  }
}

// Archived AI conversations contain user prompts and generated content.
// Retention stays disabled until a deployment explicitly sets a policy;
// deleting the session cascades its messages, citations, tools and artifacts.
async function aiChatRetention(): Promise<void> {
  const chatRetentionDays = getAiConfig().chatRetentionDays;
  // Re-checked here, not just at registration (see registerScheduledTasks):
  // a repeatable job's schedule persists in Redis across deploys, so a
  // deployment that turns retention back off must not leave a stale
  // schedule still deleting sessions until someone remembers to remove it.
  if (chatRetentionDays <= 0) return;
  try {
    const cutoff = new Date(Date.now() - chatRetentionDays * 24 * 60 * 60 * 1_000);
    const { count } = await prisma.aiChatSession.deleteMany({
      where: { archivedAt: { not: null, lt: cutoff } },
    });
    if (count > 0) logger.info({ count }, "[scheduled-tasks] Deleted AI chat session(s) past retention");
  } catch (err) {
    logger.error({ err }, "[scheduled-tasks] Failed to enforce AI chat retention");
  }
}

// Reviewer access creates short-lived credentials and privacy-sensitive
// network/device signals. Keep durable founder-facing comments and aggregate
// visit results, but enforce the narrower retention windows every day.
async function reviewerDataRetention(): Promise<void> {
  try {
    const result = await enforceReviewerRetention();
    recordReviewerRetentionRun("success", result);
    logger.info(
      { event: "reviewer_retention_completed", ...result },
      "[scheduled-tasks] Enforced reviewer data retention",
    );
  } catch (err) {
    recordReviewerRetentionRun("error");
    logger.error(
      { err, event: "reviewer_retention_failed" },
      "[scheduled-tasks] Failed to enforce reviewer data retention",
    );
  }
}

// Once a day is enough notifyOverdueAndDueTodayTasks skips tasks it has
// already notified about, so a missed or re-run tick never duplicates a
// notice.
async function dailyReminders(): Promise<void> {
  try {
    await notifyOverdueAndDueTodayTasks();
  } catch (err) {
    logger.error({ err }, "[scheduled-tasks] Failed to notify overdue/due-today tasks");
  }

  // Deliberately after the task pass and in its own try: a deal reminder is
  // less urgent than a dated task, and neither may take the other down.
  try {
    await notifyStaleLeadsAndIdleDeals();
  } catch (err) {
    logger.error({ err }, "[scheduled-tasks] Failed to notify stale leads / deals without a next step");
  }
}

// Document uploads are two-phase: createUploadSession makes the Document +
// DocumentVersion row before the browser has sent a single byte, and only
// confirm() moves it out of pending_upload. If the tab closes, the network
// drops, or the user just gives up mid-upload, nothing else ever revisits
// that row it would otherwise show as "Uploading…" forever. An hour is far
// longer than any real upload on this size cap should take.
async function staleDocumentUploadCleanup(): Promise<void> {
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
        "[scheduled-tasks] Cleaned up stale pending upload(s) and orphaned document(s)",
      );
    }
  } catch (err) {
    logger.error({ err }, "[scheduled-tasks] Failed to clean up stale document uploads");
  }
}

// Every 30 minutes rather than once a day like the reminders above a meeting
// is only useful on an investor's timeline soon after it happens, not the
// next morning.
async function calendarSyncEnqueue(): Promise<void> {
  // Re-checked here, not just at registration — see aiChatRetention's comment
  // for why: the schedule can outlive the deploy that enabled it.
  if (!isGoogleIntegrationEnabled()) return;
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
    logger.error({ err }, "[scheduled-tasks] Failed to enqueue calendar sync");
  }
}

export const scheduledTasksJob = {
  name: JOB_NAMES.scheduledTasks,
  // These six run on their own independent schedules (every 30 min to daily)
  // and never overlap in practice one worker handling them one at a time
  // keeps this from being one more knob to tune.
  concurrency: 1,
  async process(job: Job<ScheduledTaskJobData>): Promise<void> {
    switch (job.name) {
      case SCHEDULED_TASK_NAMES.pendingRegistrationCleanup: return pendingRegistrationCleanup();
      case SCHEDULED_TASK_NAMES.aiChatRetention: return aiChatRetention();
      case SCHEDULED_TASK_NAMES.reviewerDataRetention: return reviewerDataRetention();
      case SCHEDULED_TASK_NAMES.dailyReminders: return dailyReminders();
      case SCHEDULED_TASK_NAMES.staleDocumentUploadCleanup: return staleDocumentUploadCleanup();
      case SCHEDULED_TASK_NAMES.calendarSyncEnqueue: return calendarSyncEnqueue();
      default: logger.error({ jobName: job.name }, "[scheduled-tasks] Unknown scheduled task job name");
    }
  },
};

/**
 * Registers (or updates in place — `upsertJobScheduler` is an idempotent
 * upsert, safe to call on every worker boot) each schedule via BullMQ's Job
 * Scheduler API. Called once, from the worker process's own entrypoint (see
 * workers/index.ts), never from the API — that's the whole point of this
 * migration: the schedule now lives in Redis, not in a timer running inside
 * every API replica. Each schedule's own name doubles as its scheduler id,
 * since there's exactly one of each.
 *
 * The two conditional schedules (ai-chat-retention, calendar-sync-enqueue)
 * are skipped here when unconfigured so an unconfigured deployment isn't
 * carrying a schedule for nothing; each processor above re-checks its own
 * condition too, since a previously-registered schedule outlives the deploy
 * that created it.
 */
function schedule(taskName: string, pattern: string): Promise<unknown> {
  // The task's own name doubles as its scheduler id, since there's exactly
  // one schedule per task, and as the produced job's name, which is what
  // scheduledTasksJob's processor switches on.
  return scheduledTasksQueue.upsertJobScheduler(taskName, { pattern }, taskName, {});
}

export async function registerScheduledTasks(): Promise<void> {
  await schedule(SCHEDULED_TASK_NAMES.pendingRegistrationCleanup, "*/30 * * * *");

  if (getAiConfig().chatRetentionDays > 0) {
    await schedule(SCHEDULED_TASK_NAMES.aiChatRetention, "15 3 * * *");
  }

  await schedule(SCHEDULED_TASK_NAMES.reviewerDataRetention, "45 3 * * *");
  await schedule(SCHEDULED_TASK_NAMES.dailyReminders, "0 9 * * *");
  await schedule(SCHEDULED_TASK_NAMES.staleDocumentUploadCleanup, "*/30 * * * *");

  if (isGoogleIntegrationEnabled()) {
    await schedule(SCHEDULED_TASK_NAMES.calendarSyncEnqueue, "*/30 * * * *");
  }

  logger.info("Scheduled tasks registered");
}
