import { transporter } from "../config/email";

const FROM = `"FP Founders" <${process.env.SMTP_FROM ?? process.env.SMTP_USER}>`;

export async function sendOTP(to: string, firstName: string, otp: string): Promise<void> {
  await transporter.sendMail({
    from: FROM,
    to,
    subject: "Your verification code",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Hi ${firstName},</h2>
        <p>Use the code below to verify your email address. It expires in <strong>10 minutes</strong>.</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;
                    padding:24px;background:#f4f4f5;border-radius:8px;margin:24px 0">
          ${otp}
        </div>
        <p style="color:#6b7280;font-size:14px">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}
