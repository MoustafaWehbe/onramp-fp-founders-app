import { emailQueue } from "../jobs/queue";
import { otpEmail } from "../emails/templates/otp";

export async function sendOTP(to: string, firstName: string, otp: string): Promise<void> {
  const { subject, html } = otpEmail(firstName, otp);
  await emailQueue.add("send-otp", { to, subject, html });
}
