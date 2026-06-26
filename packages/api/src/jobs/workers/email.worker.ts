import type { Job } from "bullmq";

export interface EmailJobData {
  to: string;
  subject: string;
  template: string;
  variables?: Record<string, string>;
}

export interface EmailJobResult {
  messageId: string;
}

export const emailJob = {
  name: "email" as const,
  concurrency: 10,

  async process(job: Job<EmailJobData, EmailJobResult>): Promise<EmailJobResult> {
    const { to, subject, template } = job.data;
    console.info(`[email] Sending "${subject}" to ${to} (template: ${template})`);

    // TODO: integrate with your email provider (Resend, SendGrid, SES, etc.)
    await new Promise((resolve) => setTimeout(resolve, 100));

    return { messageId: `mock-${Date.now()}` };
  },
};
