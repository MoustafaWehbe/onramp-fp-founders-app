import { useEffect, useState } from "react";
import {
  Building2,
  Check,
  FileStack,
  MessagesSquare,
  Route,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import type { StartupRole } from "../../../lib/team-api";
import { cn } from "../../../lib/utils";
import {
  PERMISSION_CATALOG,
  PERMISSION_DEPENDENCIES,
  expandPermissionKeys,
  permissionLabel,
  permissionsRequiring,
} from "../../../lib/permissions";

export type RolePermissionsFormValues = {
  name?: string;
  description: string;
  permissions: string[];
};

type RolePermissionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  role?: StartupRole;
  isSubmitting: boolean;
  onSubmit: (values: RolePermissionsFormValues) => void;
};

const RESOURCE_ICONS: Record<string, LucideIcon> = {
  startup: Building2,
  team: Users,
  pipeline: Route,
  documents: FileStack,
  financial: WalletCards,
  ai_reports: Sparkles,
  chat: MessagesSquare,
};

export function RolePermissionsDialog({
  open,
  onOpenChange,
  mode,
  role,
  isSubmitting,
  onSubmit,
}: RolePermissionsDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setName(mode === "edit" ? (role?.name ?? "") : "");
    setDescription(role?.description ?? "");
    setPermissions(new Set(role?.permissions ?? []));
  }, [open, mode, role]);

  /**
   * Some grants are inert without another one: "Edit" over a resource whose
   * "View" is off produces a page that renders empty while every read behind
   * it 403s. The server closes the selection over those dependencies on save
   * regardless, so the only question here is whether the checkboxes tell the
   * truth about what is being saved — ticking a write ticks its read, and
   * un-ticking a read un-ticks the writes that needed it.
   */
  function toggle(key: string) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        for (const dependent of permissionsRequiring(key)) next.delete(dependent);
      } else {
        for (const implied of expandPermissionKeys([key])) next.add(implied);
      }
      return next;
    });
  }

  function toggleGroup(resource: string, actions: { action: string }[]) {
    const keys = actions.map((action) => `${resource}:${action.action}`);
    const allSelected = keys.every((key) => permissions.has(key));
    setPermissions((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (allSelected) next.delete(key);
        else for (const implied of expandPermissionKeys([key])) next.add(implied);
      }
      return next;
    });
  }

  /** A read grant that is currently propping up a selected write grant. */
  function requiredBy(key: string): string[] {
    return permissionsRequiring(key).filter((dependent) => permissions.has(dependent));
  }

  const canSubmit =
    (mode === "edit" || name.trim().length > 0) && permissions.size > 0 && !isSubmitting;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      ...(mode === "create" ? { name: name.trim() } : {}),
      description: description.trim(),
      // Already closed over dependencies by `toggle`; expanding again here
      // covers a role loaded from an older save that predates the rule.
      permissions: expandPermissionKeys(permissions),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 bg-linear-to-r from-primary/8 via-transparent to-transparent px-6 py-5 pr-14">
          <div className="flex items-start gap-3 text-left">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>{mode === "create" ? "Create a custom role" : `Edit ${role?.name ?? "role"}`}</DialogTitle>
              <DialogDescription className="mt-1">
                {mode === "create"
                  ? "Give teammates exactly the access they need in this workspace."
                  : "Permission changes apply immediately to everyone assigned this role."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col overflow-hidden">
          <div className="scrollbar-slim min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
            <section className="rounded-xl border border-border/70 bg-muted/12 p-4">
              <div className={cn("grid gap-4", mode === "create" && "sm:grid-cols-2")}>
                {mode === "create" && (
                  <div className="space-y-2">
                    <Label htmlFor="role-name">Role name</Label>
                    <Input
                      id="role-name"
                      value={name}
                      maxLength={50}
                      placeholder="Finance lead"
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">Use a short name teammates will recognize.</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="role-description">Description</Label>
                  <Textarea
                    id="role-description"
                    value={description}
                    maxLength={200}
                    rows={2}
                    placeholder="What this role is responsible for"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Workspace access</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Choose what members with this role can view and change.</p>
                </div>
                <div className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-[11px] tabular-nums",
                  permissions.size > 0
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-destructive/25 bg-destructive/10 text-destructive",
                )}>
                  {permissions.size} selected
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {PERMISSION_CATALOG.map((group) => {
                  const Icon = RESOURCE_ICONS[group.resource] ?? ShieldCheck;
                  const groupKeys = group.actions.map((action) => `${group.resource}:${action.action}`);
                  const selectedCount = groupKeys.filter((key) => permissions.has(key)).length;
                  const allSelected = selectedCount === groupKeys.length;

                  return (
                    <div
                      key={group.resource}
                      className={cn(
                        "rounded-xl border bg-card p-3.5 transition-colors",
                        selectedCount > 0 ? "border-primary/25" : "border-border/70",
                      )}
                    >
                      <div className="mb-3 flex items-center gap-2.5">
                        <div className={cn(
                          "grid h-8 w-8 place-items-center rounded-lg transition-colors",
                          selectedCount > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                        )}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{group.label}</div>
                          <div className="text-[11px] text-muted-foreground">{selectedCount} of {group.actions.length} enabled</div>
                        </div>
                        <button
                          type="button"
                          className="rounded-md px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-50"
                          disabled={isSubmitting}
                          onClick={() => toggleGroup(group.resource, group.actions)}
                        >
                          {allSelected ? "Clear" : "Select all"}
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {group.actions.map((action) => {
                          const key = `${group.resource}:${action.action}`;
                          const selected = permissions.has(key);
                          // Named on the control itself so the linked toggle
                          // is understood before it happens, not discovered
                          // as a checkbox moving on its own.
                          const dependencies = PERMISSION_DEPENDENCIES[key] ?? [];
                          const propping = selected ? requiredBy(key) : [];
                          const hint = propping.length > 0
                            ? `Turning this off also turns off ${propping.map(permissionLabel).join(", ")}`
                            : dependencies.length > 0 && !selected
                              ? `Also turns on ${dependencies.map(permissionLabel).join(", ")}`
                              : undefined;
                          return (
                            <button
                              key={key}
                              type="button"
                              aria-label={action.label}
                              aria-pressed={selected}
                              title={hint}
                              disabled={isSubmitting}
                              onClick={() => toggle(key)}
                              className={cn(
                                "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-card disabled:pointer-events-none disabled:opacity-50",
                                selected
                                  ? "border-primary/35 bg-primary/12 text-primary shadow-xs"
                                  : "border-border/70 bg-background/40 text-muted-foreground hover:border-primary/25 hover:bg-surface-hover hover:text-foreground",
                              )}
                            >
                              <span className={cn(
                                "grid h-4 w-4 place-items-center rounded-full border transition-colors",
                                selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                              )}>
                                {selected && <Check className="h-2.5 w-2.5 stroke-3" />}
                              </span>
                              {action.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {permissions.size === 0 && (
                <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/[0.07] px-3 py-2 text-xs text-destructive">
                  Select at least one permission before saving this role.
                </div>
              )}
            </section>
          </div>

          <DialogFooter className="shrink-0 border-t border-border/60 bg-card px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Saving…" : mode === "create" ? "Create role" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
