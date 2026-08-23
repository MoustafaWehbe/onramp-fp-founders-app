import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

type GoogleNotConnectedNoticeProps = {
  /** What the founder was trying to do send emails, schedule meetings, or both. */
  action: "send emails" | "schedule meetings" | "send emails and schedule meetings";
};

/**
 * Shown proactively on pages where email/scheduling actions live, so a
 * founder learns Google isn't connected before hitting a disabled button
 * rather than only after (see sendEmailErrorMessage / scheduleMeetingErrorMessage
 * in these same pages for the reactive fallback if the connection drops mid-session).
 */
export function GoogleNotConnectedNotice({ action }: GoogleNotConnectedNoticeProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-400">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        Connect your Google account to {action}.
      </span>
      <Link to="/settings" className="font-medium underline underline-offset-2 hover:no-underline">
        Go to Settings
      </Link>
    </div>
  );
}
