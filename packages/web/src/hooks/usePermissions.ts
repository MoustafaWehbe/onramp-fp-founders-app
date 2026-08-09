import { useCallback, useMemo } from "react";
import { useWorkspace } from "./useWorkspace";
import { roleCan, type Action, type Resource } from "../lib/permissions";

type Permissions = {
  /** The caller's role in the active workspace, or null before it resolves. */
  role: string | null;
  can: (resource: Resource, action: Action) => boolean;
};

/**
 * What the signed-in user may do in the workspace they currently have open.
 * The role travels with the workspace list, so this costs no extra request.
 */
export function usePermissions(): Permissions {
  const { activeStartup } = useWorkspace();
  const role = activeStartup?.member.role ?? null;

  const can = useCallback(
    (resource: Resource, action: Action) => roleCan(role, resource, action),
    [role],
  );

  return useMemo(() => ({ role, can }), [role, can]);
}
