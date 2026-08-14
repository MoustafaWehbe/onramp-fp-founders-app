import { Badge } from "../../../components/ui/badge";
import { cn } from "../../../lib/utils";
import { roleLabel } from "./team-types";

// A team role/status isn't a pipeline stage, so this palette is kept separate
// from StageBadge's — "warning" here means "pending invite", not "in
// negotiation". Keep each map's meaning scoped to its own domain rather than
// merging them into one shared token set.
const ROLE_CLASSES: Record<string, string> = {
  owner: "bg-primary/15 text-primary",
  collaborator: "bg-info/15 text-info",
  viewer: "bg-muted text-muted-foreground",
};

export function RoleBadge({ role }: { role: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent font-medium",
        ROLE_CLASSES[role] ?? "bg-muted text-muted-foreground",
      )}
    >
      {roleLabel(role)}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const active = status === "active";

  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent font-medium",
        active ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
      )}
    >
      {active ? "Active" : "Pending"}
    </Badge>
  );
}
