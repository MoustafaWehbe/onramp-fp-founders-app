import type { Job } from "bullmq";
import { prisma } from "../../db/prisma";

export interface GmailLogRetryJobData {
  startupInvestorId: string;
  pipelineId: string | null;
  createdBy: string;
  type: "email";
  source: "gmail";
  externalId: string;
  gmailThreadId: string;
  emailMessageId: string;
  subject: string;
  description: string;
  /** ISO string job data must be JSON-serializable, so this isn't a Date. */
  interactionDate: string;
}

export const gmailLogRetryJob = {
  name: "gmail-log-retry" as const,
  concurrency: 5,

  async process(job: Job<GmailLogRetryJobData>): Promise<void> {
    const { interactionDate, ...rest } = job.data;

    // Upsert, not create: if a second retry for the same send lands (the
    // queue's own retry-on-failure, or a duplicate enqueue), externalId's
    // per-contact uniqueness makes re-running this safe rather than a 500.
    await prisma.interactionLog.upsert({
      where: {
        startupInvestorId_externalId: {
          startupInvestorId: rest.startupInvestorId,
          externalId: rest.externalId,
        },
      },
      create: { ...rest, interactionDate: new Date(interactionDate) },
      update: {},
    });
  },
};
