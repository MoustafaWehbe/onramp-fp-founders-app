import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import type { StartupRole } from "../../../lib/team-api";
import { ROLE_HINTS, roleLabel } from "./team-types";

type InviteMemberDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: StartupRole[];
  /** Owners may invite into any role; everyone else (collaborators) may only invite viewers. */
  canInviteAnyRole: boolean;
  isSubmitting: boolean;
  onSubmit: (input: { email: string; roleId: string }) => void;
};

/** Least-privilege default so nobody hands out owner access by just hitting enter. */
function defaultRoleId(roles: StartupRole[]): string {
  return (roles.find((role) => role.name === "collaborator") ?? roles[0])?.id ?? "";
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  roles,
  canInviteAnyRole,
  isSubmitting,
  onSubmit,
}: InviteMemberDialogProps) {
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");

  const assignableRoles = canInviteAnyRole ? roles : roles.filter((role) => role.name === "viewer");

  // Roles arrive asynchronously, so seed the picker whenever the dialog opens
  // or the list finally lands.
  useEffect(() => {
    if (!open) return;
    setEmail("");
    setRoleId(canInviteAnyRole ? defaultRoleId(roles) : (assignableRoles[0]?.id ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roles, canInviteAnyRole]);

  const selectedRole = assignableRoles.find((role) => role.id === roleId);
  const canSubmit = email.trim().length > 0 && roleId !== "" && !isSubmitting;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ email: email.trim(), roleId });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They'll get an email with a link to join. The invitation is tied to this address and
            expires in 7 days.
            {!canInviteAnyRole && " As a collaborator, you can only invite viewers."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Work email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Role</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full justify-between px-3 font-normal"
                  disabled={assignableRoles.length === 0}
                >
                  <span>
                    {selectedRole ? roleLabel(selectedRole.name) : "Loading roles…"}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                {assignableRoles.map((role) => (
                  <DropdownMenuItem key={role.id} onSelect={() => setRoleId(role.id)}>
                    <div className="min-w-0">
                      <div className="font-medium">{roleLabel(role.name)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {role.description ?? ROLE_HINTS[role.name] ?? ""}
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {selectedRole && (
              <p className="text-xs text-muted-foreground">
                {selectedRole.description ?? ROLE_HINTS[selectedRole.name] ?? ""}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
