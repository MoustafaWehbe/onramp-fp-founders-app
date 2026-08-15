import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
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
import { useActiveStartupId, MY_STARTUPS_KEY } from "../../../hooks/useWorkspace";
import { qk } from "../../../lib/query-keys";
import {
  changeMemberRole,
  createRole,
  deleteRole,
  inviteMember,
  listMembers,
  listRoles,
  removeMember,
  resendInvite,
  updateRole,
  type StartupRole,
} from "../../../lib/team-api";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { MembersCardList } from "./MembersCardList";
import { MembersTable } from "./MembersTable";
import { RolePermissionsDialog, type RolePermissionsFormValues } from "./RolePermissionsDialog";
import { mapMemberToRow, roleLabel, type TeamMemberRow } from "./team-types";

const FORBIDDEN_HINT =
  "You don't have permission to manage this team only owners can invite, change roles, or remove members.";

/** Maps the API's operational error codes onto copy that explains the rule. */
function mutationErrorMessage(err: unknown, fallback: string): string {
  switch (apiErrorCode(err)) {
    case "LAST_OWNER":
      return "This is the last active owner. Promote someone else to owner first.";
    case "OWNER_ONLY":
      return "Only an owner can assign the owner role.";
    case "INVITE_ROLE_FORBIDDEN":
      return "As a collaborator, you can only invite viewers.";
    case "ALREADY_MEMBER":
      return "That person is already a member or already has a pending invitation.";
    case "ROLE_NOT_FOUND":
      return "That role no longer exists in this workspace.";
    case "ROLE_NAME_TAKEN":
      return "A role with that name already exists.";
    case "OWNER_ROLE_LOCKED":
      return "The owner role's permissions can't be changed.";
    case "SYSTEM_ROLE":
      return "Built-in roles can't be deleted.";
    case "ROLE_IN_USE":
      return "This role is still assigned to members move them to another role first.";
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
  const [roleDialog, setRoleDialog] = useState<{ mode: "create" | "edit"; role?: StartupRole } | null>(null);
  const [pendingRoleDelete, setPendingRoleDelete] = useState<StartupRole | null>(null);

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

  const canInvite = can("team", "create");
  const canChangeRole = can("team", "update");
  const canRemoveMember = can("team", "delete");
  const canManageRoles = can("team", "manage");
  // Owners may invite into any role; collaborators (the only other holder of
  // team:create) may only invite viewers enforced server-side too.
  const canInviteAnyRole = myRole === "owner";

  const activeCount = members.filter((member) => !member.isPending).length;
  const pendingCount = members.length - activeCount;

  const invalidateMembers = () =>
    void queryClient.invalidateQueries({ queryKey: qk.members(startupId) });

  const invalidateRoles = () => {
    void queryClient.invalidateQueries({ queryKey: qk.roles(startupId) });
    // A role's own permissions may have just changed, which changes what the
    // signed-in owner (or anyone else) is allowed to do refresh the
    // workspace list so usePermissions sees the new grants right away.
    void queryClient.invalidateQueries({ queryKey: MY_STARTUPS_KEY });
  };

  const inviteMutation = useMutation({
    mutationFn: (input: { email: string; roleId: string }) => inviteMember(startupId, input),
    onSuccess: (result, input) => {
      setInviteOpen(false);
      if (result.emailQueued) {
        toast.success(`Invitation sent to ${input.email}`);
      } else {
        // The membership row exists either way. The raw token never leaves the
        // server, so there is no link to share by hand resending issues a
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

  const createRoleMutation = useMutation({
    mutationFn: (input: RolePermissionsFormValues) =>
      createRole(startupId, { name: input.name!, description: input.description || undefined, permissions: input.permissions }),
    onSuccess: (role) => {
      toast.success(`${roleLabel(role.name)} role created`);
      setRoleDialog(null);
      invalidateRoles();
    },
    onError: (err) => toast.error(mutationErrorMessage(err, "Could not create the role")),
  });

  const updateRoleMutation = useMutation({
    mutationFn: (input: { roleId: string; values: RolePermissionsFormValues }) =>
      updateRole(startupId, input.roleId, {
        description: input.values.description,
        permissions: input.values.permissions,
      }),
    onSuccess: (role) => {
      toast.success(`${roleLabel(role.name)} permissions updated`);
      setRoleDialog(null);
      invalidateRoles();
    },
    onError: (err) => toast.error(mutationErrorMessage(err, "Could not update the role")),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (role: StartupRole) => deleteRole(startupId, role.id),
    onSuccess: (_result, role) => {
      setPendingRoleDelete(null);
      toast.success(`${roleLabel(role.name)} role deleted`);
      invalidateRoles();
    },
    onError: (err) => toast.error(mutationErrorMessage(err, "Could not delete the role")),
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
          canInvite ? (
            <Button size="sm" type="button" onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4" />
              Invite teammate
            </Button>
          ) : null
        }
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-semibold">Roles &amp; permissions</h2>
            <p className="text-sm text-muted-foreground">
              {activeCount} member{activeCount === 1 ? "" : "s"}
              {pendingCount > 0 && ` · ${pendingCount} pending`} · you're{" "}
              {myRole ? roleLabel(myRole) : "—"}
            </p>
          </div>
          {canManageRoles && (
            <Button size="sm" variant="outline" onClick={() => setRoleDialog({ mode: "create" })}>
              <Plus className="h-4 w-4" />
              New role
            </Button>
          )}
        </div>

        {rolesQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
            {Array.from({ length: 3 }, (_, i) => (
              <Card key={i}>
                <CardContent className="space-y-2 p-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((role) => {
              const isOwnerRole = role.name === "owner";
              return (
                <Card key={role.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        {roleLabel(role.name)}
                      </span>
                      <span className="font-mono text-[11px] font-normal tabular-nums text-muted-foreground">
                        {role.memberCount} member{role.memberCount === 1 ? "" : "s"}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <p className="text-sm text-muted-foreground">
                      {role.description || `${role.permissions.length} permissions granted`}
                    </p>
                    {isOwnerRole ? (
                      <p className="text-xs text-muted-foreground">Full access can't be changed.</p>
                    ) : (
                      canManageRoles && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRoleDialog({ mode: "edit", role })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit permissions
                          </Button>
                          {!role.isSystemRole && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              disabled={role.memberCount > 0}
                              title={role.memberCount > 0 ? "Move members off this role first" : undefined}
                              onClick={() => setPendingRoleDelete(role)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </Button>
                          )}
                        </div>
                      )
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

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
                canResend={canInvite}
                canChangeRole={canChangeRole}
                canRemove={canRemoveMember}
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
                canResend={canInvite}
                canChangeRole={canChangeRole}
                canRemove={canRemoveMember}
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
        canInviteAnyRole={canInviteAnyRole}
        isSubmitting={inviteMutation.isPending}
        onSubmit={(input) => inviteMutation.mutate(input)}
      />

      <RolePermissionsDialog
        open={roleDialog !== null}
        onOpenChange={(open) => !open && setRoleDialog(null)}
        mode={roleDialog?.mode ?? "create"}
        role={roleDialog?.role}
        isSubmitting={createRoleMutation.isPending || updateRoleMutation.isPending}
        onSubmit={(values) =>
          roleDialog?.mode === "edit" && roleDialog.role
            ? updateRoleMutation.mutate({ roleId: roleDialog.role.id, values })
            : createRoleMutation.mutate(values)
        }
      />

      <ConfirmDialog
        open={pendingRoleDelete !== null}
        onOpenChange={(open) => !open && setPendingRoleDelete(null)}
        title={`Delete the ${pendingRoleDelete ? roleLabel(pendingRoleDelete.name) : ""} role?`}
        description="This role is removed permanently. It can only be deleted while no one currently holds it."
        confirmLabel="Delete role"
        pendingLabel="Deleting…"
        isPending={deleteRoleMutation.isPending}
        onConfirm={() => pendingRoleDelete && deleteRoleMutation.mutate(pendingRoleDelete)}
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
