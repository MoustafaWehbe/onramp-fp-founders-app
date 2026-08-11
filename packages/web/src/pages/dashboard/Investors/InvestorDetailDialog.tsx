import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Linkedin, Mail, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { usePermissions } from "../../../hooks/usePermissions";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-error";
import {
  createInteractionLog,
  deleteInteractionLog,
  listLogsForInvestor,
  updateInteractionLog,
  type InteractionLog,
} from "../../../lib/interaction-log-api";
import { INVESTOR_TYPE_LABELS } from "../../../lib/investor-api";
import { fetchAllPages } from "../../../lib/pagination";
import { listPipelineStageEvents } from "../../../lib/pipeline-api";
import { listMembers } from "../../../lib/team-api";
import { cn, getInitials } from "../../../lib/utils";
import { InteractionTimeline } from "./InteractionTimeline";
import { LogInteractionDialog, type LogFormValues } from "./LogInteractionDialog";
import { StageBadge } from "./StageBadge";
import type { InvestorRow } from "./investor-types";

type InvestorDetailDialogProps = {
  startupId: string;
  investor: InvestorRow | null;
  onOpenChange: (open: boolean) => void;
  onEditInvestor: (investor: InvestorRow) => void;
};

function logErrorMessage(err: unknown, fallback: string): string {
  switch (apiErrorCode(err)) {
    case "PIPELINE_MISMATCH":
      return "That pipeline entry belongs to a different contact.";
    case "LOG_NOT_FOUND":
      return "That entry no longer exists — a teammate may have removed it.";
    case "INVESTOR_NOT_FOUND":
      return "This contact no longer exists.";
    default:
      return apiErrorMessage(
        err,
        fallback,
        "You don't have permission to change interaction history here.",
      );
  }
}

export function InvestorDetailDialog({
  startupId,
  investor,
  onOpenChange,
  onEditInvestor,
}: InvestorDetailDialogProps) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canCreate = can("pipeline", "create");

  const [logOpen, setLogOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<InteractionLog | null>(null);
  const [pendingDelete, setPendingDelete] = useState<InteractionLog | null>(null);

  const investorId = investor?.id ?? null;

  const logsQuery = useQuery({
    queryKey: ["interaction-logs", startupId, investorId],
    queryFn: () =>
      fetchAllPages((page, limit) =>
        listLogsForInvestor(startupId, investorId!, { page, limit }),
      ).then((data) => ({ data })),
    enabled: investorId !== null,
  });

  const pipelineId = investor?.pipelineId ?? null;

  // Only contacts on the board have stage history; a prospect has none yet.
  const stageEventsQuery = useQuery({
    queryKey: ["pipeline-stage-events", startupId, pipelineId],
    queryFn: () => listPipelineStageEvents(startupId, pipelineId!),
    enabled: pipelineId !== null,
  });

  // Logs carry only a createdBy user id. The members list is already cached by
  // the Team page and readable by every role, so reuse it to put a name on each
  // entry rather than showing a raw uuid.
  const membersQuery = useQuery({
    queryKey: ["team-members", startupId],
    queryFn: () => listMembers(startupId),
    enabled: investorId !== null,
  });

  const authorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of membersQuery.data ?? []) {
      if (member.user) {
        map.set(member.user.id, `${member.user.firstName} ${member.user.lastName}`.trim());
      }
    }
    return map;
  }, [membersQuery.data]);

  const logs = logsQuery.data?.data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["interaction-logs", startupId, investorId] });
    // Logging an interaction is what moves a contact out of Prospects, and it
    // also feeds nextFollowupDate on the list — both come from the list query.
    void queryClient.invalidateQueries({ queryKey: ["investors", startupId] });
  };

  const saveMutation = useMutation({
    mutationFn: (values: LogFormValues) =>
      editingLog
        ? updateInteractionLog(startupId, editingLog.id, values)
        : createInteractionLog(startupId, { investorId: investorId!, ...values }),
    onSuccess: () => {
      toast.success(editingLog ? "Interaction updated" : "Interaction logged");
      setLogOpen(false);
      setEditingLog(null);
      invalidate();
    },
    onError: (err) => toast.error(logErrorMessage(err, "Could not save the interaction")),
  });

  const deleteMutation = useMutation({
    mutationFn: (log: InteractionLog) => deleteInteractionLog(startupId, log.id),
    onSuccess: () => {
      toast.success("Interaction removed");
      setPendingDelete(null);
      invalidate();
    },
    onError: (err) => toast.error(logErrorMessage(err, "Could not remove the interaction")),
  });

  const details = investor
    ? [
        { label: "Firm", value: investor.firm },
        {
          label: "Type",
          value: investor.investorType ? INVESTOR_TYPE_LABELS[investor.investorType] : "—",
        },
        { label: "Sector focus", value: investor.sector },
        { label: "Stage preference", value: investor.stagePreference },
        { label: "Source", value: investor.contact.source ?? "—" },
      ]
    : [];

  return (
    <>
      <Dialog open={investor !== null} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          {investor && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-sm font-semibold text-primary">
                    {getInitials(investor.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="truncate">{investor.name}</DialogTitle>
                    <DialogDescription className="truncate">
                      {investor.email || "No email on file"}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex flex-wrap items-center gap-2">
                <StageBadge stageId={investor.pipelineStageId} />
                {logs.length > 0 ? (
                  <Badge
                    variant="outline"
                    className="border-transparent bg-success/15 font-medium text-success"
                  >
                    {logs.length} interaction{logs.length === 1 ? "" : "s"}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-transparent bg-muted font-medium text-muted-foreground"
                  >
                    Not contacted
                  </Badge>
                )}
                {investor.email && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={`mailto:${investor.email}`}>
                      <Mail className="h-3.5 w-3.5" /> Email
                    </a>
                  </Button>
                )}
                {investor.linkedinUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={investor.linkedinUrl} target="_blank" rel="noreferrer">
                      <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                    </a>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => onEditInvestor(investor)}
                >
                  Edit details
                </Button>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-surface/50 p-3 text-sm sm:grid-cols-3">
                {details.map((item) => (
                  <div key={item.label} className="min-w-0">
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="truncate text-foreground">{item.value}</dd>
                  </div>
                ))}
              </dl>

              {investor.contact.notes && (
                <p className="whitespace-pre-wrap rounded-xl border border-border/70 bg-surface/50 p-3 text-sm text-muted-foreground">
                  {investor.contact.notes}
                </p>
              )}

              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold">Interaction history</h3>
                {canCreate && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingLog(null);
                      setLogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Log interaction
                  </Button>
                )}
              </div>

              <div className={cn("max-h-[40vh] overflow-y-auto pr-1", "scrollbar-slim")}>
                <InteractionTimeline
                  logs={logs}
                  stageEvents={stageEventsQuery.data ?? []}
                  authorNames={authorNames}
                  // stageEventsQuery is disabled for a prospect with no pipeline
                  // entry — isPending stays true forever on a disabled query, so
                  // it must not count as "loading" while fetchStatus is idle.
                  isLoading={
                    logsQuery.isPending ||
                    (stageEventsQuery.isPending && stageEventsQuery.fetchStatus !== "idle")
                  }
                  onEdit={(log) => {
                    setEditingLog(log);
                    setLogOpen(true);
                  }}
                  onDelete={setPendingDelete}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <LogInteractionDialog
        open={logOpen}
        onOpenChange={(open) => {
          setLogOpen(open);
          if (!open) setEditingLog(null);
        }}
        investorName={investor?.name ?? ""}
        log={editingLog}
        isSubmitting={saveMutation.isPending}
        onSubmit={(values) => saveMutation.mutate(values)}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this interaction?</DialogTitle>
            <DialogDescription>
              The entry is deleted permanently. If it was the only one and the contact isn't on
              the pipeline board, they move back to Prospects.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
            >
              {deleteMutation.isPending ? "Removing…" : "Remove interaction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
