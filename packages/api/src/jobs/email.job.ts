import type { Job } from "bullmq";
import type { EmailJobData, EmailJobResult } from "../types";

export async function processEmailJob(
  job: Job<EmailJobData, EmailJobResult>,
): Promise<EmailJobResult> {
  const { to, subject, template } = job.data;
  console.info(`[email] Sending "${subject}" to ${to} (template: ${template})`);

  // TODO: integrate with your email provider (Resend, SendGrid, SES, etc.)
  await new Promise((resolve) => setTimeout(resolve, 100));

  return { messageId: `mock-${Date.now()}` };
}
