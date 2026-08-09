import { getInitials } from "../../../lib/utils";
import type { StartupRole } from "../../../lib/team-api";
import { MemberActions } from "./MemberActions";
import { RoleBadge, StatusBadge } from "./TeamBadges";
import type { TeamMemberRow } from "./team-types";

type MembersTableProps = {
  members: TeamMemberRow[];
  roles: StartupRole[];
  canManage: boolean;
  currentUserId: string | null;
  onChangeRole: (member: TeamMemberRow, roleId: string) => void;
  onRemove: (member: TeamMemberRow) => void;
  onResend: (member: TeamMemberRow) => void;
  busyMemberId?: string | null;
};

export function MembersTable({
  members,
  roles,
  canManage,
  currentUserId,
  onChangeRole,
  onRemove,
  onResend,
  busyMemberId = null,
}: MembersTableProps) {
  return (
    <div className="scrollbar-slim overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface/60 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Member</th>
            <th scope="col" className="px-4 py-3 font-medium">Role</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
            <th scope="col" className="px-4 py-3 font-medium">Joined</th>
            <th scope="col" className="w-12 px-4 py-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {members.map((member) => {
            const isSelf = member.userId !== null && member.userId === currentUserId;

            return (
              <tr key={member.id} className="transition-colors hover:bg-surface-hover/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {member.avatarUrl ? (
                      <img
                        src={member.avatarUrl}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-xs font-semibold text-primary">
                        {getInitials(member.name)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">{member.name}</span>
                        {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {member.isPending ? "Invitation pending" : member.email || "No email"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <RoleBadge role={member.role} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={member.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {member.joined}
                </td>
                <td className="px-4 py-3">
                  <MemberActions
                    member={member}
                    roles={roles}
                    canManage={canManage}
                    isSelf={isSelf}
                    onChangeRole={onChangeRole}
                    onRemove={onRemove}
                    onResend={onResend}
                    busy={busyMemberId === member.id}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
