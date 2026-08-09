import { getInitials } from "../../../lib/utils";
import type { StartupRole } from "../../../lib/team-api";
import { MemberActions } from "./MemberActions";
import { RoleBadge, StatusBadge } from "./TeamBadges";
import type { TeamMemberRow } from "./team-types";

type MembersCardListProps = {
  members: TeamMemberRow[];
  roles: StartupRole[];
  canManage: boolean;
  currentUserId: string | null;
  onChangeRole: (member: TeamMemberRow, roleId: string) => void;
  onRemove: (member: TeamMemberRow) => void;
  onResend: (member: TeamMemberRow) => void;
  busyMemberId?: string | null;
};

export function MembersCardList({
  members,
  roles,
  canManage,
  currentUserId,
  onChangeRole,
  onRemove,
  onResend,
  busyMemberId = null,
}: MembersCardListProps) {
  return (
    <ul className="divide-y divide-border/60">
      {members.map((member) => {
        const isSelf = member.userId !== null && member.userId === currentUserId;

        return (
          <li key={member.id} className="flex items-start gap-3 p-4">
            {member.avatarUrl ? (
              <img
                src={member.avatarUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-xs font-semibold text-primary">
                {getInitials(member.name)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {member.name}
                    </span>
                    {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {member.isPending ? "Invitation pending" : member.email || "No email"}
                  </div>
                </div>
                <div className="shrink-0 text-[11px] text-muted-foreground">{member.joined}</div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <RoleBadge role={member.role} />
                <StatusBadge status={member.status} />
              </div>
            </div>

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
          </li>
        );
      })}
    </ul>
  );
}
