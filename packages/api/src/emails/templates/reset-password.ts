export function resetPasswordEmail(
  firstName: string,
  resetUrl: string,
): { subject: string; html: string } {
  return {
    subject: "Reset your password",
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 4px 16px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background-color:#0f172a;padding:32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">FP Founders</span>
                  </td>
                  <td align="right">
                    <span style="font-size:12px;font-weight:500;color:#94a3b8;letter-spacing:0.5px;text-transform:uppercase;">Password Reset</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">

              <!-- Greeting -->
              <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.4px;">Hi ${firstName},</p>
              <p style="margin:0 0 32px;font-size:15px;color:#64748b;line-height:1.6;">
                We received a request to reset your password. Click the button below to choose a new one.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}" target="_blank"
                      style="display:inline-block;padding:14px 32px;background-color:#0f172a;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;letter-spacing:-0.1px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Expiry notice -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;">
                    <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
                      This link expires in <strong>15 minutes</strong>. If you didn't request a password reset, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td style="border-top:1px solid #f1f5f9;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>

              <!-- Disclaimer -->
              <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
                If you didn't request this, no action is needed. Your password will remain unchanged.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;border-top:1px solid #f1f5f9;padding:20px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:12px;color:#cbd5e1;">
                      &copy; ${new Date().getFullYear()} FP Founders. All rights reserved.
                    </p>
                  </td>
                  <td align="right">
                    <p style="margin:0;font-size:12px;color:#cbd5e1;">Secure Email</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Card -->

        <!-- Sub-footer -->
        <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center;">
          This is an automated message — please do not reply.
        </p>

      </td>
    </tr>
  </table>

</body>
</html>
    `,
  };
}
