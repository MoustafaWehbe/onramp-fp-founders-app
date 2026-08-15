import { useCallback, useMemo } from "react";
import { useWorkspace } from "./useWorkspace";
import type { Action, Resource } from "../lib/permissions";

type Permissions = {
  /** The caller's role in the active workspace, or null before it resolves. */
  role: string | null;
  can: (resource: Resource, action: Action) => boolean;
};

/**
 * What the signed-in user may do in the workspace they currently have open.
 * Checked against the role's live "resource:action" grants (from the DB, via
 * the workspace list response) rather than a hardcoded per-role table — a
 * role's permissions can be edited, or a workspace can define its own custom
 * role, and this must reflect that without a code change.
 */
export function usePermissions(): Permissions {
  const { activeStartup } = useWorkspace();
  const role = activeStartup?.member.role ?? null;
  const permissions = activeStartup?.member.permissions;

  const can = useCallback(
    (resource: Resource, action: Action) => permissions?.includes(`${resource}:${action}`) ?? false,
    [permissions],
  );

  return useMemo(() => ({ role, can }), [role, can]);
}
