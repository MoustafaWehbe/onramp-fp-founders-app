import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog";
import { apiErrorMessage } from "../../lib/api-error";
import { useActiveStartupId } from "../../hooks/useWorkspace";
import { GOOGLE_CONNECTION_QUERY_KEY, useGoogleConnectionStatus } from "../../hooks/useGoogleConnection";
import { deleteAllSyncedInteractionLogs } from "../../lib/interaction-log-api";
import { invalidateInteractionData } from "../../lib/query-keys";
import {
  connectGoogleAccount,
  disconnectGoogleAccount,
  type GoogleConnectionStatus,
} from "../../lib/integrations-api";

const QUERY_KEY = GOOGLE_CONNECTION_QUERY_KEY;

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l2.85-2.22.81-.62Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z" />
    </svg>
  );
}

function formatLastSynced(iso: string | null | undefined): string {
  if (!iso) return "Never synced yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never synced yet";
  return `Last synced ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)}`;
}

export function ConnectedAccountsCard() {
  const queryClient = useQueryClient();
  const startupId = useActiveStartupId();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [removeSyncedOpen, setRemoveSyncedOpen] = useState(false);

  const statusQuery = useGoogleConnectionStatus();

  const disconnectMutation = useMutation({
    mutationFn: disconnectGoogleAccount,
    onSuccess: () => {
      setDisconnectOpen(false);
      toast.success("Google account disconnected");
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not disconnect your Google account"));
    },
  });

  const removeSyncedMutation = useMutation({
    mutationFn: () => deleteAllSyncedInteractionLogs(startupId, "google_calendar"),
    onSuccess: (count) => {
      setRemoveSyncedOpen(false);
      toast.success(count === 0 ? "No synced meetings to remove" : `Removed ${count} synced meeting${count === 1 ? "" : "s"}`);
      invalidateInteractionData(queryClient, startupId);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not remove synced meetings"));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected accounts</CardTitle>
        <CardDescription>
          Connect Google to log investor meetings and emails automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {statusQuery.isLoading ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <GoogleRow
            status={statusQuery.data}
            onConnect={connectGoogleAccount}
            onDisconnect={() => setDisconnectOpen(true)}
            onRemoveSynced={() => setRemoveSyncedOpen(true)}
          />
        )}
      </CardContent>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect Google account?"
        description="Meeting and email auto-logging will stop. Interactions already logged stay in place."
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting…"
        isPending={disconnectMutation.isPending}
        onConfirm={() => disconnectMutation.mutate()}
      />

      <ConfirmDialog
        open={removeSyncedOpen}
        onOpenChange={setRemoveSyncedOpen}
        title="Remove synced meetings?"
        description="Every interaction logged automatically from Google Calendar in this workspace is deleted. Meetings you edited by hand, and everything logged manually, are left alone."
        confirmLabel="Remove synced meetings"
        pendingLabel="Removing…"
        isPending={removeSyncedMutation.isPending}
        onConfirm={() => removeSyncedMutation.mutate()}
      />
    </Card>
  );
}

function GoogleRow({
  status,
  onConnect,
  onDisconnect,
  onRemoveSynced,
}: {
  status: GoogleConnectionStatus | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
  onRemoveSynced: () => void;
}) {
  if (!status?.configured) {
    return (
      <div className="space-y-1">
        <div className="text-sm font-medium">Google</div>
        <p className="text-sm text-muted-foreground">
          Google integration is not set up for this environment.
        </p>
      </div>
    );
  }

  if (!status.connected) {
    const needsReauth = status.status === "needs_reauth";
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            Google
            {needsReauth && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Needs reconnect
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {needsReauth
              ? `Access to ${status.googleEmail ?? "your Google account"} was revoked. Reconnect to resume auto-logging.`
              : "Not connected."}
          </p>
        </div>
        <Button onClick={onConnect}>
          <GoogleIcon className="mr-2 h-4 w-4 shrink-0" />
          {needsReauth ? "Reconnect" : "Connect Google"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            Google
            <Badge
              variant="outline"
              className="gap-1 border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            >
              <CheckCircle2 className="h-3 w-3" />
              Connected
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{status.googleEmail}</p>
        </div>
        <Button variant="outline" onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface/40 px-3.5 py-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Calendar meetings</p>
          <p className="text-xs text-muted-foreground">
            {formatLastSynced(status.lastSyncedAt)} · syncs automatically
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemoveSynced}>
          Remove synced meetings
        </Button>
      </div>
    </div>
  );
}
