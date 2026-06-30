import { emailQueue } from "../jobs/queue";
import { otpEmail } from "../emails/templates/otp";
import { resetPasswordEmail } from "../emails/templates/reset-password";

export async function sendOTP(to: string, firstName: string, otp: string): Promise<void> {
  const { subject, html } = otpEmail(firstName, otp);
  await emailQueue.add("send-otp", { to, subject, html });
}

export async function sendPasswordReset(to: string, firstName: string, resetUrl: string): Promise<void> {
  const { subject, html } = resetPasswordEmail(firstName, resetUrl);
  await emailQueue.add("send-password-reset", { to, subject, html });
}
