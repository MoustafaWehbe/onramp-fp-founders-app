import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "../ui/button";
import { EmptyState } from "./EmptyState";
import { usePermissions } from "../../hooks/usePermissions";
import { permissionLabel, resourceBlurb, type Action, type Resource } from "../../lib/permissions";

type NoAccessProps = {
  resource: Resource;
  action: Action;
};

/**
 * What a member sees instead of a page their role cannot open.
 *
 * It names the exact grant, using the same wording the Team & Roles editor
 * puts on that checkbox, so the ask a founder makes of their owner matches
 * what the owner has to tick. Anyone who can manage roles gets a link
 * straight there; everyone else is told who to ask, because sending them to
 * a page they also cannot open would only move the dead end.
 */
export function NoAccess({ resource, action }: NoAccessProps) {
  const { can } = usePermissions();
  const canManageRoles = can("team", "manage");

  return (
    <div className="mx-auto w-full max-w-lg py-10">
      <div className="rounded-xl border border-border/70 bg-card">
        <EmptyState
          icon={Lock}
          title="You don't have access to this"
          description={
            <>
              Your role in this workspace doesn't include {resourceBlurb(resource)}. Opening this
              page needs the <span className="font-medium text-foreground">{permissionLabel(`${resource}:${action}`)}</span>{" "}
              permission.
              {!canManageRoles && " A workspace owner or admin can enable it on the Team & Roles page."}
            </>
          }
          action={
            canManageRoles ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/team">Open Team & Roles</Link>
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link to="/dashboard">Back to dashboard</Link>
              </Button>
            )
          }
        />
      </div>
    </div>
  );
}
