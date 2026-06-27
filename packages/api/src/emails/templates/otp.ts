export function otpEmail(firstName: string, otp: string): { subject: string; html: string } {
  return {
    subject: "Your verification code",
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Your verification code</title>
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
                    <span style="font-size:12px;font-weight:500;color:#94a3b8;letter-spacing:0.5px;text-transform:uppercase;">Verification</span>
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
                Use the code below to verify your email address and complete your registration.
              </p>

              <!-- OTP Box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center" style="background-color:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:28px 24px;">
                    <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;">Your verification code</p>
                    <p style="margin:0;font-size:44px;font-weight:800;letter-spacing:14px;color:#0f172a;font-variant-numeric:tabular-nums;">${otp}</p>
                  </td>
                </tr>
              </table>

              <!-- Expiry notice -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;">
                    <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
                      ⏱ This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
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
                If you didn't create an account with FP Founders, you can safely ignore this email. Someone may have entered your address by mistake.
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
