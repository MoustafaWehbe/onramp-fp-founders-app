import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { EmptyState } from "../../../components/shared/EmptyState";
import { ConfirmDialog } from "../../../components/shared/ConfirmDialog";
import { useAuth } from "../../../hooks/useAuth";
import { usePermissions } from "../../../hooks/usePermissions";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-error";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { qk } from "../../../lib/query-keys";
import {
  changeMemberRole,
  inviteMember,
  listMembers,
  listRoles,
  removeMember,
  resendInvite,
} from "../../../lib/team-api";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { MembersCardList } from "./MembersCardList";
import { MembersTable } from "./MembersTable";
import { mapMemberToRow, roleLabel, type TeamMemberRow } from "./team-types";

const FORBIDDEN_HINT =
  "You don't have permission to manage this team — only owners can invite, change roles, or remove members.";

/** Maps the API's operational error codes onto copy that explains the rule. */
function mutationErrorMessage(err: unknown, fallback: string): string {
  switch (apiErrorCode(err)) {
    case "LAST_OWNER":
      return "This is the last active owner. Promote someone else to owner first.";
    case "OWNER_ONLY":
      return "Only an owner can assign the owner role.";
    case "ALREADY_MEMBER":
      return "That person is already a member or already has a pending invitation.";
    case "ROLE_NOT_FOUND":
      return "That role no longer exists in this workspace.";
    default:
      return apiErrorMessage(err, fallback, FORBIDDEN_HINT);
  }
}

export function Team() {
  const startupId = useActiveStartupId();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<TeamMemberRow | null>(null);

  const membersQuery = useQuery({
    queryKey: qk.members(startupId),
    queryFn: () => listMembers(startupId),
  });

  const rolesQuery = useQuery({
    queryKey: qk.roles(startupId),
    queryFn: () => listRoles(startupId),
  });

  const members = useMemo(
    () => (membersQuery.data ?? []).map(mapMemberToRow),
    [membersQuery.data],
  );

  const roles = rolesQuery.data ?? [];

  // Role comes from the workspace list rather than being re-derived here, so
  // every screen agrees on what the caller may do.
  const { role: myRole, can } = usePermissions();

  // team:create / team:update / team:delete travel together — only owners hold
  // any of them, so one check covers inviting, role changes and removal.
  const canManage = can("team", "create");

  const activeCount = members.filter((member) => !member.isPending).length;
  const pendingCount = members.length - activeCount;

  const invalidateMembers = () =>
    void queryClient.invalidateQueries({ queryKey: qk.members(startupId) });

  const inviteMutation = useMutation({
    mutationFn: (input: { email: string; roleId: string }) => inviteMember(startupId, input),
    onSuccess: (result, input) => {
      setInviteOpen(false);
      if (result.emailQueued) {
        toast.success(`Invitation sent to ${input.email}`);
      } else {
        // The membership row exists either way. The raw token never leaves the
        // server, so there is no link to share by hand — resending issues a
        // fresh one and mails it again.
        toast.warning(
          `${input.email} was invited, but the email failed to send. Use Resend invitation to try again.`,
        );
      }
      invalidateMembers();
    },
    onError: (err) => toast.error(mutationErrorMessage(err, "Could not send the invitation")),
  });

  const roleMutation = useMutation({
    mutationFn: (input: { member: TeamMemberRow; roleId: string }) =>
      changeMemberRole(startupId, input.member.id, input.roleId),
    onSuccess: (_result, input) => {
      const next = roles.find((role) => role.id === input.roleId);
      toast.success(
        next
          ? `${input.member.name} is now ${roleLabel(next.name)}`
          : `${input.member.name}'s role was updated`,
      );
      invalidateMembers();
    },
    onError: (err) => toast.error(mutationErrorMessage(err, "Could not change the role")),
  });

  const resendMutation = useMutation({
    mutationFn: (member: TeamMemberRow) => resendInvite(startupId, member.id),
    onSuccess: (result, member) => {
      if (result.emailQueued) {
        // The old link stops working, which matters if they still have it.
        toast.success(`A new invitation was sent to ${member.name}`);
      } else {
        toast.warning(
          `A new link was issued for ${member.name}, but the email failed to send.`,
        );
      }
      invalidateMembers();
    },
    onError: (err) => toast.error(mutationErrorMessage(err, "Could not resend the invitation")),
  });

  const removeMutation = useMutation({
    mutationFn: (member: TeamMemberRow) => removeMember(startupId, member.id),
    onSuccess: (_result, member) => {
      setPendingRemoval(null);
      toast.success(
        member.isPending ? "Invitation revoked" : `${member.name} was removed from the team`,
      );
      invalidateMembers();
    },
    onError: (err) => toast.error(mutationErrorMessage(err, "Could not remove the member")),
  });

  const busyMemberId = roleMutation.isPending
    ? (roleMutation.variables?.member.id ?? null)
    : removeMutation.isPending
      ? (removeMutation.variables?.id ?? null)
      : resendMutation.isPending
        ? (resendMutation.variables?.id ?? null)
        : null;

  const removingSelf = pendingRemoval?.userId !== null && pendingRemoval?.userId === user?.id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Manage teammates, roles, and who can see this workspace."
        actions={
          canManage ? (
            <Button size="sm" type="button" onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4" />
              Invite teammate
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Team members</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-4xl font-semibold tabular-nums">
              {membersQuery.isLoading ? <Skeleton className="h-9 w-12" /> : activeCount}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              People with access to this workspace.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-4xl font-semibold tabular-nums">
              {membersQuery.isLoading ? <Skeleton className="h-9 w-12" /> : pendingCount}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Invitations waiting to be accepted.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your role</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-medium">{myRole ? roleLabel(myRole) : "—"}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {canManage
                ? "You can invite teammates and change roles."
                : "Only owners can change team membership."}
            </p>
          </CardContent>
        </Card>
      </div>

      {membersQuery.isError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
          {apiErrorMessage(
            membersQuery.error,
            "Failed to load the team.",
            "You're not an active member of this workspace.",
          )}
        </div>
      )}

      <div className="card-elevated overflow-hidden">
        {membersQuery.isLoading ? (
          <div className="divide-y divide-border/60" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-6">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="hidden h-5 w-16 shrink-0 sm:block" />
              </div>
            ))}
          </div>
        ) : members.length === 0 && !membersQuery.isError ? (
          <EmptyState
            icon={Users}
            title="No teammates yet"
            description="Invite the people you're raising with so they can work the pipeline alongside you."
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <MembersTable
                members={members}
                roles={roles}
                canManage={canManage}
                currentUserId={user?.id ?? null}
                onChangeRole={(member, roleId) => roleMutation.mutate({ member, roleId })}
                onRemove={setPendingRemoval}
                onResend={(member) => resendMutation.mutate(member)}
                busyMemberId={busyMemberId}
              />
            </div>

            <div className="lg:hidden">
              <MembersCardList
                members={members}
                roles={roles}
                canManage={canManage}
                currentUserId={user?.id ?? null}
                onChangeRole={(member, roleId) => roleMutation.mutate({ member, roleId })}
                onRemove={setPendingRemoval}
                onResend={(member) => resendMutation.mutate(member)}
                busyMemberId={busyMemberId}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
              <div className="tabular-nums">
                {activeCount} member{activeCount === 1 ? "" : "s"}
                {pendingCount > 0 && ` · ${pendingCount} pending`}
              </div>
            </div>
          </>
        )}
      </div>

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roles}
        isSubmitting={inviteMutation.isPending}
        onSubmit={(input) => inviteMutation.mutate(input)}
      />

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
        title={
          pendingRemoval?.isPending
            ? "Revoke this invitation?"
            : removingSelf
              ? "Leave this workspace?"
              : `Remove ${pendingRemoval?.name}?`
        }
        description={
          pendingRemoval?.isPending
            ? `${pendingRemoval.name} will no longer be able to use their invitation link.`
            : removingSelf
              ? "You'll lose access to this workspace immediately and will need a new invitation to return."
              : "They lose access to this workspace immediately. Anything they created stays."
        }
        confirmLabel={
          pendingRemoval?.isPending
            ? "Revoke invitation"
            : removingSelf
              ? "Leave workspace"
              : "Remove member"
        }
        pendingLabel="Removing…"
        isPending={removeMutation.isPending}
        onConfirm={() => pendingRemoval && removeMutation.mutate(pendingRemoval)}
      />
    </div>
  );
}
