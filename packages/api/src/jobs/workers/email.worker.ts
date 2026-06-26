import type { Job } from "bullmq";
import { transporter } from "../../config/email";
import type { EmailJobData, EmailJobResult } from "../../types";

export const emailJob = {
  name: "email" as const,
  concurrency: 10,

  async process(job: Job<EmailJobData, EmailJobResult>): Promise<EmailJobResult> {
    const { to, subject, html } = job.data;

    const info = await transporter.sendMail({
      from: `"FP Founders" <${process.env.SMTP_FROM ?? process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });

    return { messageId: info.messageId };
  },
};
