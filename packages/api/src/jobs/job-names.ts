/** Shared queue names keep producers and workers on the same BullMQ channels. */
export const JOB_NAMES = {
  email: "email",
  embeddings: "embeddings",
  documentProcessing: "document-processing",
  documentRasterize: "document-rasterize",
  calendarSync: "calendar-sync",
  gmailLogRetry: "gmail-log-retry",
  aiAnalysis: "ai-analysis",
  scheduledTasks: "scheduled-tasks",
} as const;
