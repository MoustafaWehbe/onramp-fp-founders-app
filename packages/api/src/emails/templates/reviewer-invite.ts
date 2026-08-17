function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "#";
    return escapeHtml(url);
  } catch {
    return "#";
  }
}

export function reviewerInviteEmail(
  startupName: string,
  reviewerName: string | null,
  accessUrl: string,
  expiresAt: Date,
  personalMessage: string | null,
): { subject: string; html: string } {
  const safeStartup = escapeHtml(startupName);
  const safeLink = safeUrl(accessUrl);
  const greeting = reviewerName ? `Hi ${escapeHtml(reviewerName)},` : "Hi there,";
  const expiryLabel = expiresAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return {
    subject: `${safeStartup} invited you to review their documents`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Document Review Invitation</title>
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
                    <span style="font-size:12px;font-weight:500;color:#94a3b8;letter-spacing:0.5px;text-transform:uppercase;">Document Review</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">

              <!-- Greeting -->
              <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.4px;">${greeting}</p>
              <p style="margin:0 0 32px;font-size:15px;color:#64748b;line-height:1.6;">
                <strong>${safeStartup}</strong> has invited you to securely review their fundraising documents. Click below to verify your email and get access.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <a href="${safeLink}" target="_blank"
                      style="display:inline-block;padding:14px 32px;background-color:#0f172a;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;letter-spacing:-0.1px;">
                      Review Documents
                    </a>
                  </td>
                </tr>
              </table>

              ${
                personalMessage
                  ? `<!-- Personal message -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #0f172a;border-radius:8px;padding:16px 20px;">
                    <p style="margin:0 0 6px;font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;">Message from ${safeStartup}</p>
                    <p style="margin:0;font-size:14px;color:#334155;line-height:1.6;">${escapeHtml(personalMessage)}</p>
                  </td>
                </tr>
              </table>`
                  : ""
              }

              <!-- Expiry notice -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;">
                    <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
                      This access link expires on <strong>${expiryLabel}</strong>. You'll be asked to verify your email with a one-time code before viewing any document.
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
                If the button doesn't work, copy and paste this link into your browser:<br />
                <span style="color:#64748b;word-break:break-all;">${safeLink}</span>
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
          This is an automated message please do not reply.
        </p>

      </td>
    </tr>
  </table>

</body>
</html>
    `,
  };
}
