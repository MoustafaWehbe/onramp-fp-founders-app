import { Outlet, useLocation } from "react-router-dom";
import { NoAccess } from "../components/shared/NoAccess";
import { usePermissions } from "../hooks/usePermissions";
import { PAGE_ACCESS } from "../lib/page-access";

/**
 * Turns a page the caller's role cannot open into one honest explanation
 * instead of a rendered shell that fills with 403 toasts.
 *
 * It reads the same PAGE_ACCESS map the sidebar filters on, so a hidden nav
 * item and a blocked route can never disagree — and a deep link, a
 * notification, or a stale bookmark lands on the same explanation the nav
 * would have withheld.
 *
 * This is presentation, not enforcement: every route behind it is still gated
 * server-side. A member who edits their bundle out of this check gains an
 * empty page and a row of 403s, which is what they had before.
 */
export function RequirePermission() {
  const { pathname } = useLocation();
  const { can } = usePermissions();

  const requirement = PAGE_ACCESS[pathname];
  if (requirement && !can(requirement.resource, requirement.action)) {
    return <NoAccess resource={requirement.resource} action={requirement.action} />;
  }

  return <Outlet />;
}
