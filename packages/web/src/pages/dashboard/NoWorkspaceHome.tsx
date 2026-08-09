import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Mail, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { CreateStartupDialog } from "../../components/startup/CreateStartupDialog";
import { LoadingSpinner } from "../../components/shared/LoadingSpinner";
import { useWorkspace, MY_STARTUPS_KEY } from "../../hooks/useWorkspace";
import { useMyInvites, MY_INVITES_KEY } from "../../hooks/useMyInvites";
import { NOTIFICATIONS_KEY } from "../../hooks/useNotifications";
import { apiErrorMessage } from "../../lib/api-error";
import { acceptMyInvite, declineMyInvite, type PendingInvite } from "../../lib/invite-api";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  collaborator: "Collaborator",
  viewer: "Viewer",
};

function inviterName(invite: PendingInvite) {
  if (!invite.inviter) return null;
  const full = `${invite.inviter.firstName} ${invite.inviter.lastName}`.trim();
  return full || invite.inviter.email;
}

/**
 * What the dashboard shows to someone who belongs to no workspace yet: they
 * either start one or wait for an invitation. Both live here so the empty state
 * is a place to act from rather than a dead end.
 */
export function NoWorkspaceHome() {
  const queryClient = useQueryClient();
  const { setActiveStartupId } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const invitesQuery = useMyInvites();
  const invites = invitesQuery.data ?? [];

  const acceptMutation = useMutation({
    mutationFn: (invite: PendingInvite) => acceptMyInvite(invite.id),
    onSuccess: async (_member, invite) => {
      // Land them in the workspace they just joined rather than wherever the
      // resolution order would otherwise have pointed.
      setActiveStartupId(invite.startup.id);
      await queryClient.invalidateQueries({ queryKey: MY_STARTUPS_KEY });
      await queryClient.invalidateQueries({ queryKey: MY_INVITES_KEY });
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      toast.success(`You've joined ${invite.startup.name}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not accept the invitation")),
    onSettled: () => setBusyId(null),
  });

  const declineMutation = useMutation({
    mutationFn: (invite: PendingInvite) => declineMyInvite(invite.id),
    onSuccess: async (_void, invite) => {
      await queryClient.invalidateQueries({ queryKey: MY_INVITES_KEY });
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      toast.success(`Declined the invitation to ${invite.startup.name}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not decline the invitation")),
    onSettled: () => setBusyId(null),
  });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 py-6 sm:py-10">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <Rocket className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            You're not in a workspace yet
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start your own startup, or wait for a teammate to invite you — invitations show up
            right here.
          </p>
        </div>
      </div>

      {invitesQuery.isPending ? (
        <div className="card-elevated grid place-items-center p-10">
          <LoadingSpinner />
        </div>
      ) : invites.length > 0 ? (
        <section className="card-elevated overflow-hidden">
          <div className="border-b border-border/60 px-5 py-3">
            <h2 className="font-display text-sm font-semibold">
              {invites.length === 1 ? "1 invitation" : `${invites.length} invitations`}
            </h2>
          </div>
          <ul className="divide-y divide-border/60">
            {invites.map((invite) => {
              const busy = busyId === invite.id;
              const from = inviterName(invite);

              return (
                <li key={invite.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface text-muted-foreground">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">
                      {invite.startup.name}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {ROLE_LABELS[invite.role.name] ?? invite.role.name}
                      {from && <> · invited by {from}</>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setBusyId(invite.id);
                        declineMutation.mutate(invite);
                      }}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setBusyId(invite.id);
                        acceptMutation.mutate(invite);
                      }}
                    >
                      {busy ? "Joining…" : "Accept"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="card-elevated flex flex-col items-center gap-2 p-10 text-center">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-surface text-muted-foreground">
            <Mail className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-foreground">No invitations waiting</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            If someone invites you, it'll appear here and in your notifications — you won't need
            the email link.
          </p>
        </section>
      )}

      <div className="card-elevated flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Raising for your own startup?</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Create a workspace to track your pipeline, investors and team.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setCreateOpen(true)}>
          Create a startup
        </Button>
      </div>

      <CreateStartupDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
