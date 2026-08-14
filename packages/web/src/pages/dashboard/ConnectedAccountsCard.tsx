import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
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
  setCalendarSyncEnabled,
  triggerCalendarSync,
  type GoogleConnectionStatus,
} from "../../lib/integrations-api";

const QUERY_KEY = GOOGLE_CONNECTION_QUERY_KEY;

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

  const syncNowMutation = useMutation({
    mutationFn: triggerCalendarSync,
    onSuccess: (stats) => {
      toast.success(
        stats.created + stats.updated + stats.retracted === 0
          ? "No new meetings to log"
          : `Synced: ${stats.created} new, ${stats.updated} updated, ${stats.retracted} removed`,
      );
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      invalidateInteractionData(queryClient, startupId);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not sync your calendar"));
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (enabled: boolean) => setCalendarSyncEnabled(enabled),
    onSuccess: (_data, enabled) => {
      toast.success(enabled ? "Calendar sync resumed" : "Calendar sync paused");
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not update calendar sync"));
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
            onSyncNow={() => syncNowMutation.mutate()}
            isSyncing={syncNowMutation.isPending}
            onTogglePause={(enabled) => pauseMutation.mutate(enabled)}
            isTogglingPause={pauseMutation.isPending}
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
  onSyncNow,
  isSyncing,
  onTogglePause,
  isTogglingPause,
  onRemoveSynced,
}: {
  status: GoogleConnectionStatus | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
  onSyncNow: () => void;
  isSyncing: boolean;
  onTogglePause: (enabled: boolean) => void;
  isTogglingPause: boolean;
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
        <Button onClick={onConnect}>{needsReauth ? "Reconnect" : "Connect Google"}</Button>
      </div>
    );
  }

  const syncPaused = status.calendarSyncEnabled === false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            Google
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Connected
            </Badge>
            {syncPaused && <Badge variant="outline">Sync paused</Badge>}
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
          <p className="text-xs text-muted-foreground">{formatLastSynced(status.lastSyncedAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={isTogglingPause}
            onClick={() => onTogglePause(syncPaused)}
          >
            {syncPaused ? "Resume sync" : "Pause sync"}
          </Button>
          <Button variant="ghost" size="sm" disabled={isSyncing} onClick={onSyncNow}>
            <RefreshCw className={isSyncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            {isSyncing ? "Syncing…" : "Sync now"}
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemoveSynced}>
            Remove synced meetings
          </Button>
        </div>
      </div>
    </div>
  );
}
