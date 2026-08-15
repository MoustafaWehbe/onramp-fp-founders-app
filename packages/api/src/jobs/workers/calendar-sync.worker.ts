import type { Job } from "bullmq";
import { calendarSyncService, type SyncStats } from "../../services/calendar-sync.service";

export interface CalendarSyncJobData {
  userId: string;
}

export const calendarSyncJob = {
  name: "calendar-sync" as const,
  // Google Calendar API quota is per-project, not per-connection a low
  // concurrency keeps many connections syncing at once from bursting it.
  concurrency: 3,

  async process(job: Job<CalendarSyncJobData, SyncStats>): Promise<SyncStats> {
    const { userId } = job.data;
    const stats = await calendarSyncService.syncUserCalendar(userId);
    console.info(
      `[calendar-sync] user ${userId}: +${stats.created} ~${stats.updated} -${stats.retracted} (${stats.skipped} skipped)`,
    );
    return stats;
  },
};
