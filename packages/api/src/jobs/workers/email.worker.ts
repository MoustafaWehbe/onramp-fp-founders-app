import type { Job } from "bullmq";
import { resend } from "../../config/email";
import type { EmailJobData, EmailJobResult } from "../../types";

export const emailJob = {
  name: "email" as const,
  concurrency: 10,

  async process(job: Job<EmailJobData, EmailJobResult>): Promise<EmailJobResult> {
    const { to, subject, html } = job.data;

    if (!resend) {
      throw new Error("RESEND_API_KEY is not configured. Email sending is disabled.");
    }

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM ?? "FP Founders <noreply@fpfounders.com>",
      to,
      subject,
      html,
    });

    if (error) throw new Error(`Failed to send email: ${error.message}`);

    return { messageId: data!.id };
  },
};
