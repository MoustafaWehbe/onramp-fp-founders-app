import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Checkbox } from "../../../components/ui/checkbox";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import type { StartupRole } from "../../../lib/team-api";
import { cn } from "../../../lib/utils";
import { PERMISSION_CATALOG } from "./permission-catalog";

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

  function toggle(key: string) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const canSubmit =
    (mode === "edit" || name.trim().length > 0) && permissions.size > 0 && !isSubmitting;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      ...(mode === "create" ? { name: name.trim() } : {}),
      description: description.trim(),
      permissions: [...permissions],
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New role" : `Edit ${role?.name ?? "role"} permissions`}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Custom roles can be assigned to teammates just like the built-in ones."
              : "Changes apply immediately to everyone currently holding this role."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="role-description">Description</Label>
            <Textarea
              id="role-description"
              value={description}
              maxLength={200}
              rows={2}
              placeholder="What this role is for"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Permissions</Label>
            <div className="scrollbar-slim max-h-80 space-y-3 overflow-y-auto rounded-lg border border-border/70 p-3">
              {PERMISSION_CATALOG.map((group) => (
                <div key={group.resource} className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">{group.label}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {group.actions.map((a) => {
                      const key = `${group.resource}:${a.action}`;
                      return (
                        <label
                          key={key}
                          className={cn(
                            "flex items-center gap-1.5 text-sm",
                            isSubmitting && "opacity-60",
                          )}
                        >
                          <Checkbox
                            checked={permissions.has(key)}
                            disabled={isSubmitting}
                            onChange={() => toggle(key)}
                          />
                          {a.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {permissions.size === 0 && (
              <p className="text-xs text-destructive">Select at least one permission.</p>
            )}
          </div>

          <DialogFooter>
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
