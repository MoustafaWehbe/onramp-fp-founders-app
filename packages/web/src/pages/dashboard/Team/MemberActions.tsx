import { Mail, MoreHorizontal, Send, Shield, UserMinus } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import type { StartupRole } from "../../../lib/team-api";
import { roleLabel, type TeamMemberRow } from "./team-types";

type MemberActionsProps = {
  member: TeamMemberRow;
  roles: StartupRole[];
  /** team:create resending only re-issues a link for a role already decided. */
  canResend: boolean;
  /** team:update */
  canChangeRole: boolean;
  /** team:delete */
  canRemove: boolean;
  isSelf: boolean;
  onChangeRole: (member: TeamMemberRow, roleId: string) => void;
  onRemove: (member: TeamMemberRow) => void;
  onResend: (member: TeamMemberRow) => void;
  busy?: boolean;
};

export function MemberActions({
  member,
  roles,
  canResend,
  canChangeRole,
  canRemove,
  isSelf,
  onChangeRole,
  onRemove,
  onResend,
  busy = false,
}: MemberActionsProps) {
  const removeLabel = member.isPending
    ? "Revoke invitation"
    : isSelf
      ? "Leave workspace"
      : "Remove from team";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Actions for ${member.name}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {member.email && (
          <DropdownMenuItem asChild>
            <a href={`mailto:${member.email}`}>
              <Mail className="mr-2 h-4 w-4" /> Send email
            </a>
          </DropdownMenuItem>
        )}

        {canResend && member.isPending && (
          <DropdownMenuItem disabled={busy} onSelect={() => onResend(member)}>
            <Send className="mr-2 h-4 w-4" /> Resend invitation
          </DropdownMenuItem>
        )}

        {canChangeRole && roles.length > 0 && (
          <>
            {member.email && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="flex items-center gap-2">
              <Shield className="h-3.5 w-3.5" /> Change role
            </DropdownMenuLabel>
            {roles.map((role) => (
              <DropdownMenuItem
                key={role.id}
                disabled={busy || role.name === member.role}
                onSelect={() => onChangeRole(member, role.id)}
              >
                {roleLabel(role.name)}
                {role.name === member.role && (
                  <span className="ml-auto text-xs text-muted-foreground">Current</span>
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {canRemove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              disabled={busy}
              onSelect={() => onRemove(member)}
            >
              <UserMinus className="mr-2 h-4 w-4" />
              {removeLabel}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
