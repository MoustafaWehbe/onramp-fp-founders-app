import type { Job } from "bullmq";
import { resend } from "../../config/email";
import type { EmailJobData, EmailJobResult } from "../../types";
import { JOB_NAMES } from "../job-names";
import { prisma } from "../../db/prisma";

export const emailJob = {
  name: JOB_NAMES.email,
  concurrency: 10,

  async process(job: Job<EmailJobData, EmailJobResult>): Promise<EmailJobResult> {
    const { to, subject, html, reviewerInvitationId, deliveryGeneration } = job.data;

    if (reviewerInvitationId && deliveryGeneration !== undefined) {
      const current = await prisma.reviewerInvitation.findUnique({
        where: { id: reviewerInvitationId },
        select: { deliveryGeneration: true },
      });
      if (!current || current.deliveryGeneration !== deliveryGeneration) {
        return { messageId: "skipped-stale-reviewer-invitation" };
      }
    }

    try {
      const { data, error } = await resend.emails.send({
        from: process.env.RESEND_FROM ?? "FP Founders <noreply@fpfounders.com>",
        to,
        subject,
        html,
      });

      if (error) throw new Error(`Failed to send email: ${error.message}`);

      if (reviewerInvitationId && deliveryGeneration !== undefined) {
        await prisma.reviewerInvitation.updateMany({
          where: { id: reviewerInvitationId, deliveryGeneration },
          data: {
            deliveryStatus: "sent",
            deliverySentAt: new Date(),
            deliveryFailedAt: null,
            deliveryError: null,
            deliveryMessageId: data!.id,
          },
        });
      }

      return { messageId: data!.id };
    } catch (error) {
      if (reviewerInvitationId && deliveryGeneration !== undefined) {
        const message = error instanceof Error ? error.message : "Email delivery failed";
        await prisma.reviewerInvitation.updateMany({
          where: { id: reviewerInvitationId, deliveryGeneration },
          data: {
            deliveryStatus: "failed",
            deliveryFailedAt: new Date(),
            deliveryError: message.slice(0, 1000),
          },
        });
      }
      throw error;
    }
  },
};
