import type { Job } from "bullmq";
import { JOB_NAMES } from "../job-names";
import { calendarSyncService, type SyncStats } from "../../services/calendar-sync.service";

export interface CalendarSyncJobData {
  userId: string;
}

export const calendarSyncJob = {
  name: JOB_NAMES.calendarSync,
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
