jest.mock("../../src/db/prisma", () => ({
  prisma: {
    pendingRegistration: { deleteMany: jest.fn() },
    aiChatSession: { deleteMany: jest.fn() },
    documentVersion: { deleteMany: jest.fn() },
    document: { deleteMany: jest.fn() },
    googleConnection: { findMany: jest.fn() },
  },
}));
jest.mock("../../src/jobs/pipeline-reminders", () => ({ notifyStaleLeadsAndIdleDeals: jest.fn() }));
jest.mock("../../src/jobs/task-notifications", () => ({ notifyOverdueAndDueTodayTasks: jest.fn() }));
jest.mock("../../src/jobs/reviewer-retention", () => ({ enforceReviewerRetention: jest.fn() }));
jest.mock("../../src/observability/reviewer-metrics", () => ({ recordReviewerRetentionRun: jest.fn() }));
jest.mock("../../src/config/ai", () => ({ getAiConfig: jest.fn() }));
jest.mock("../../src/config/env", () => ({ isGoogleIntegrationEnabled: jest.fn() }));
jest.mock("../../src/jobs/queue", () => ({
  calendarSyncQueue: { add: jest.fn() },
  scheduledTasksQueue: { upsertJobScheduler: jest.fn() },
}));

import { prisma } from "../../src/db/prisma";
import { notifyStaleLeadsAndIdleDeals } from "../../src/jobs/pipeline-reminders";
import { notifyOverdueAndDueTodayTasks } from "../../src/jobs/task-notifications";
import { enforceReviewerRetention } from "../../src/jobs/reviewer-retention";
import { recordReviewerRetentionRun } from "../../src/observability/reviewer-metrics";
import { getAiConfig } from "../../src/config/ai";
import { isGoogleIntegrationEnabled } from "../../src/config/env";
import { calendarSyncQueue, scheduledTasksQueue } from "../../src/jobs/queue";
import { scheduledTasksJob, registerScheduledTasks, SCHEDULED_TASK_NAMES } from "../../src/jobs/workers/scheduled-tasks.worker";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function jobNamed(name: string) {
  return { name, data: {} } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.pendingRegistration.deleteMany.mockResolvedValue({ count: 0 } as never);
  mockPrisma.aiChatSession.deleteMany.mockResolvedValue({ count: 0 } as never);
  mockPrisma.documentVersion.deleteMany.mockResolvedValue({ count: 0 } as never);
  mockPrisma.document.deleteMany.mockResolvedValue({ count: 0 } as never);
  mockPrisma.googleConnection.findMany.mockResolvedValue([]);
  (getAiConfig as jest.Mock).mockReturnValue({ chatRetentionDays: 0 });
  (isGoogleIntegrationEnabled as jest.Mock).mockReturnValue(false);
});

describe("scheduledTasksJob.process dispatch", () => {
  it("routes pending-registration-cleanup to the pending registration sweep", async () => {
    await scheduledTasksJob.process(jobNamed(SCHEDULED_TASK_NAMES.pendingRegistrationCleanup));
    expect(mockPrisma.pendingRegistration.deleteMany).toHaveBeenCalledWith({ where: { otpExpiresAt: { lt: expect.any(Date) } } });
  });

  it("routes daily-reminders to both notification passes, the deal pass surviving even if the task pass throws", async () => {
    (notifyOverdueAndDueTodayTasks as jest.Mock).mockRejectedValue(new Error("db blip"));
    (notifyStaleLeadsAndIdleDeals as jest.Mock).mockResolvedValue(undefined);

    await scheduledTasksJob.process(jobNamed(SCHEDULED_TASK_NAMES.dailyReminders));

    expect(notifyOverdueAndDueTodayTasks).toHaveBeenCalled();
    expect(notifyStaleLeadsAndIdleDeals).toHaveBeenCalled();
  });

  it("routes reviewer-data-retention to enforceReviewerRetention and records the outcome", async () => {
    (enforceReviewerRetention as jest.Mock).mockResolvedValue({ expiredChallengesDeleted: 2 });

    await scheduledTasksJob.process(jobNamed(SCHEDULED_TASK_NAMES.reviewerDataRetention));

    expect(enforceReviewerRetention).toHaveBeenCalled();
    expect(recordReviewerRetentionRun).toHaveBeenCalledWith("success", { expiredChallengesDeleted: 2 });
  });

  it("routes stale-document-upload-cleanup to both the version and orphan-document sweeps", async () => {
    await scheduledTasksJob.process(jobNamed(SCHEDULED_TASK_NAMES.staleDocumentUploadCleanup));

    expect(mockPrisma.documentVersion.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ processingStatus: "pending_upload" }) }));
    expect(mockPrisma.document.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ versions: { none: {} } }) }));
  });

  it("logs and does nothing for an unrecognized job name, rather than throwing", async () => {
    await expect(scheduledTasksJob.process(jobNamed("not-a-real-task"))).resolves.toBeUndefined();
  });
});

describe("ai-chat-retention", () => {
  it("skips the sweep when retention is off, even if the job fires (a stale schedule from a prior deploy)", async () => {
    (getAiConfig as jest.Mock).mockReturnValue({ chatRetentionDays: 0 });

    await scheduledTasksJob.process(jobNamed(SCHEDULED_TASK_NAMES.aiChatRetention));

    expect(mockPrisma.aiChatSession.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes archived sessions past the configured retention window", async () => {
    (getAiConfig as jest.Mock).mockReturnValue({ chatRetentionDays: 30 });

    await scheduledTasksJob.process(jobNamed(SCHEDULED_TASK_NAMES.aiChatRetention));

    expect(mockPrisma.aiChatSession.deleteMany).toHaveBeenCalledWith({
      where: { archivedAt: { not: null, lt: expect.any(Date) } },
    });
  });
});

describe("calendar-sync-enqueue", () => {
  it("skips entirely when the Google integration isn't configured, even if the job fires", async () => {
    (isGoogleIntegrationEnabled as jest.Mock).mockReturnValue(false);

    await scheduledTasksJob.process(jobNamed(SCHEDULED_TASK_NAMES.calendarSyncEnqueue));

    expect(mockPrisma.googleConnection.findMany).not.toHaveBeenCalled();
  });

  it("enqueues one calendar sync per active, sync-enabled connection, deduped by a stable jobId", async () => {
    (isGoogleIntegrationEnabled as jest.Mock).mockReturnValue(true);
    mockPrisma.googleConnection.findMany.mockResolvedValue([{ userId: "user-1" }, { userId: "user-2" }] as never);

    await scheduledTasksJob.process(jobNamed(SCHEDULED_TASK_NAMES.calendarSyncEnqueue));

    expect(calendarSyncQueue.add).toHaveBeenCalledWith("calendar-sync", { userId: "user-1" }, { jobId: "calendar-sync:user-1" });
    expect(calendarSyncQueue.add).toHaveBeenCalledWith("calendar-sync", { userId: "user-2" }, { jobId: "calendar-sync:user-2" });
  });
});

describe("registerScheduledTasks", () => {
  it("registers the five unconditional schedules with their cron patterns", async () => {
    await registerScheduledTasks();

    expect(scheduledTasksQueue.upsertJobScheduler).toHaveBeenCalledWith(
      SCHEDULED_TASK_NAMES.pendingRegistrationCleanup, { pattern: "*/30 * * * *" },
      SCHEDULED_TASK_NAMES.pendingRegistrationCleanup, {},
    );
    expect(scheduledTasksQueue.upsertJobScheduler).toHaveBeenCalledWith(
      SCHEDULED_TASK_NAMES.reviewerDataRetention, { pattern: "45 3 * * *" },
      SCHEDULED_TASK_NAMES.reviewerDataRetention, {},
    );
    expect(scheduledTasksQueue.upsertJobScheduler).toHaveBeenCalledWith(
      SCHEDULED_TASK_NAMES.dailyReminders, { pattern: "0 9 * * *" },
      SCHEDULED_TASK_NAMES.dailyReminders, {},
    );
    expect(scheduledTasksQueue.upsertJobScheduler).toHaveBeenCalledWith(
      SCHEDULED_TASK_NAMES.staleDocumentUploadCleanup, { pattern: "*/30 * * * *" },
      SCHEDULED_TASK_NAMES.staleDocumentUploadCleanup, {},
    );
  });

  it("registers ai-chat-retention only when a retention policy is configured", async () => {
    (getAiConfig as jest.Mock).mockReturnValue({ chatRetentionDays: 0 });
    await registerScheduledTasks();
    expect(scheduledTasksQueue.upsertJobScheduler).not.toHaveBeenCalledWith(
      SCHEDULED_TASK_NAMES.aiChatRetention, expect.anything(), expect.anything(), expect.anything(),
    );

    jest.clearAllMocks();
    (getAiConfig as jest.Mock).mockReturnValue({ chatRetentionDays: 30 });
    await registerScheduledTasks();
    expect(scheduledTasksQueue.upsertJobScheduler).toHaveBeenCalledWith(
      SCHEDULED_TASK_NAMES.aiChatRetention, { pattern: "15 3 * * *" },
      SCHEDULED_TASK_NAMES.aiChatRetention, {},
    );
  });

  it("registers calendar-sync-enqueue only when the Google integration is configured", async () => {
    (isGoogleIntegrationEnabled as jest.Mock).mockReturnValue(false);
    await registerScheduledTasks();
    expect(scheduledTasksQueue.upsertJobScheduler).not.toHaveBeenCalledWith(
      SCHEDULED_TASK_NAMES.calendarSyncEnqueue, expect.anything(), expect.anything(), expect.anything(),
    );

    jest.clearAllMocks();
    (isGoogleIntegrationEnabled as jest.Mock).mockReturnValue(true);
    await registerScheduledTasks();
    expect(scheduledTasksQueue.upsertJobScheduler).toHaveBeenCalledWith(
      SCHEDULED_TASK_NAMES.calendarSyncEnqueue, { pattern: "*/30 * * * *" },
      SCHEDULED_TASK_NAMES.calendarSyncEnqueue, {},
    );
  });
});
