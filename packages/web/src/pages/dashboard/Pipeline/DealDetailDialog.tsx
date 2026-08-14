import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Linkedin, Mail, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Checkbox } from "../../../components/ui/checkbox";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import { usePermissions } from "../../../hooks/usePermissions";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-error";
import {
  createInteractionLog,
  deleteInteractionLog,
  listLogsForInvestor,
  updateInteractionLog,
  type InteractionLog,
} from "../../../lib/interaction-log-api";
import { INVESTOR_TYPE_LABELS, type InvestorType } from "../../../lib/investor-api";
import { DEFAULT_PROBABILITY_BY_STAGE, STAGES, type PipelineStageId } from "../../../lib/mock-data";
import { fetchAllPages } from "../../../lib/pagination";
import {
  listPipelineStageEvents,
  updatePipelineEntry,
  type CommitmentDraft,
  type PipelineEntry,
} from "../../../lib/pipeline-api";
import { listMembers } from "../../../lib/team-api";
import {
  OPEN_ROUND_STATUSES,
  ROUND_STATUS_LABELS,
  type FundraisingRound,
} from "../../../lib/fundraising-api";
import { PRIORITIES, PRIORITY_LABELS, type Priority } from "../../../lib/task-api";
import { cn, formatCompactUsd, getInitials } from "../../../lib/utils";
import { InteractionTimeline } from "../Investors/InteractionTimeline";
import { LogInteractionDialog, type LogFormValues } from "../Investors/LogInteractionDialog";
import {
  formatDateTime,
  formatDaysAgo,
  formatDuration,
  type DealSignals,
} from "./deal-signals";
import { CommitDialog } from "./CommitDialog";
import { PassReasonDialog } from "./PassReasonDialog";
import { TaskList } from "./TaskList";

/** "Passed" is an exit, not a step, so it sits apart from the progression. */
const PROGRESSION = STAGES.filter((stage) => stage.id !== "passed");

type DealDetailDialogProps = {
  startupId: string;
  deal: PipelineEntry | null;
  signals: DealSignals;
  /** Named in the commit prompt, so it's clear which raise the money lands in. */
  roundName: string;
  /** Every round this deal could be carried into, plus the one it's in. */
  rounds: FundraisingRound[];
  onOpenChange: (open: boolean) => void;
  onRemove: (deal: PipelineEntry) => void;
};

function logErrorMessage(err: unknown, fallback: string): string {
  switch (apiErrorCode(err)) {
    case "PIPELINE_MISMATCH":
      return "That pipeline entry belongs to a different contact.";
    case "LOG_NOT_FOUND":
      return "That entry no longer exists — a teammate may have removed it.";
    case "PIPELINE_NOT_FOUND":
      return "This deal is no longer on the board.";
    case "HAS_DEPENDENTS":
      return "This deal has commitments recorded against its round, so it can't be moved to another one.";
    case "ALREADY_IN_PIPELINE":
      return "This investor already has a deal in that round.";
    case "ROUND_NOT_OPEN":
      return "That round is closed, so it can't take this deal.";
    case "COMMITMENT_DETAILS_REQUIRED":
      return "Moving a deal to Committed needs a commitment amount.";
    default:
      return apiErrorMessage(
        err,
        fallback,
        "You don't have permission to change this deal.",
      );
  }
}

export function DealDetailDialog({
  startupId,
  deal,
  signals,
  roundName,
  rounds,
  onOpenChange,
  onRemove,
}: DealDetailDialogProps) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canUpdate = can("pipeline", "update");
  const canCreate = can("pipeline", "create");
  const canDelete = can("pipeline", "delete");

  const [logOpen, setLogOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<InteractionLog | null>(null);
  const [pendingLogDelete, setPendingLogDelete] = useState<InteractionLog | null>(null);
  const [amount, setAmount] = useState("");
  const [probability, setProbability] = useState("");
  const [investorFitScore, setInvestorFitScore] = useState("");
  const [passReasonOpen, setPassReasonOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);

  const investorId = deal?.investor.id ?? null;

  // Reset the editable fields whenever a different deal is opened, so a stale
  // draft never leaks onto the next investor.
  useEffect(() => {
    if (!deal) return;
    setAmount(deal.expectedAmount == null ? "" : String(deal.expectedAmount));
    setProbability(deal.probabilityPercentage == null ? "" : String(deal.probabilityPercentage));
    setInvestorFitScore(deal.investorFitScore == null ? "" : String(deal.investorFitScore));
  }, [deal]);

  const logsQuery = useQuery({
    queryKey: ["interaction-logs", startupId, investorId],
    queryFn: () =>
      fetchAllPages((page, limit) =>
        listLogsForInvestor(startupId, investorId!, { page, limit }),
      ).then((data) => ({ data })),
    enabled: investorId !== null,
  });

  // Who added this deal and who's moved its stage since — shown alongside
  // the logged interactions so "what happened" always answers "who did it".
  const stageEventsQuery = useQuery({
    queryKey: ["pipeline-stage-events", startupId, deal?.id],
    queryFn: () => listPipelineStageEvents(startupId, deal!.id),
    enabled: deal !== null,
  });

  // Logs carry only a createdBy user id; the members list puts a name on each.
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
    void queryClient.invalidateQueries({ queryKey: ["interaction-logs", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["pipeline", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["investors", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["pipeline-stage-events", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["pipeline-focus", startupId] });
  };

  const dealMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updatePipelineEntry>[2]) =>
      updatePipelineEntry(startupId, deal!.id, patch),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(logErrorMessage(err, "Could not update the deal")),
  });

  const saveLogMutation = useMutation({
    mutationFn: (values: LogFormValues) =>
      editingLog
        ? updateInteractionLog(startupId, editingLog.id, values)
        : createInteractionLog(startupId, {
            investorId: investorId!,
            // Attaching the pipeline entry keeps the log tied to this deal.
            pipelineId: deal!.id,
            ...values,
          }),
    onSuccess: () => {
      toast.success(editingLog ? "Interaction updated" : "Interaction logged");
      setLogOpen(false);
      setEditingLog(null);
      invalidate();
    },
    onError: (err) => toast.error(logErrorMessage(err, "Could not save the interaction")),
  });

  const deleteLogMutation = useMutation({
    mutationFn: (log: InteractionLog) => deleteInteractionLog(startupId, log.id),
    onSuccess: () => {
      toast.success("Interaction removed");
      setPendingLogDelete(null);
      invalidate();
    },
    onError: (err) => toast.error(logErrorMessage(err, "Could not remove the interaction")),
  });

  const commitAmount = () => {
    if (!deal || !canUpdate) return;
    const trimmed = amount.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (Number.isNaN(next) || next < 0)) {
      toast.error("Expected amount must be a positive number");
      setAmount(deal.expectedAmount == null ? "" : String(deal.expectedAmount));
      return;
    }
    if (next === (deal.expectedAmount ?? null)) return;
    dealMutation.mutate({ expectedAmount: next });
  };

  const commitProbability = () => {
    if (!deal || !canUpdate) return;
    const trimmed = probability.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (Number.isNaN(next) || next < 0 || next > 100)) {
      toast.error("Probability must be between 0 and 100");
      setProbability(deal.probabilityPercentage == null ? "" : String(deal.probabilityPercentage));
      return;
    }
    if (next === (deal.probabilityPercentage ?? null)) return;
    dealMutation.mutate({ probabilityPercentage: next });
  };

  const commitInvestorFitScore = () => {
    if (!deal || !canUpdate) return;
    const trimmed = investorFitScore.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (Number.isNaN(next) || next < 0 || next > 100)) {
      toast.error("Investor fit must be between 0 and 100");
      setInvestorFitScore(deal.investorFitScore == null ? "" : String(deal.investorFitScore));
      return;
    }
    if (next === (deal.investorFitScore ?? null)) return;
    dealMutation.mutate({ investorFitScore: next });
  };

  const moveToStage = (stage: PipelineStageId) => {
    if (!deal || !canUpdate || stage === deal.stage) return;
    // Passing requires a reason the server records on the stage history —
    // collect it first instead of mutating straight away.
    if (stage === "passed") {
      setPassReasonOpen(true);
      return;
    }
    // Committing writes money against the round, so it collects the amount
    // first — same holding pattern as passing.
    if (stage === "committed") {
      setCommitOpen(true);
      return;
    }
    const nextProbability = DEFAULT_PROBABILITY_BY_STAGE[stage];
    setProbability(String(nextProbability));
    dealMutation.mutate({ stage, probabilityPercentage: nextProbability });
  };

  const confirmPass = (reason: string) => {
    if (!deal) return;
    const nextProbability = DEFAULT_PROBABILITY_BY_STAGE.passed;
    setProbability(String(nextProbability));
    dealMutation.mutate(
      { stage: "passed", probabilityPercentage: nextProbability, reason },
      { onSuccess: () => setPassReasonOpen(false) },
    );
  };

  const confirmCommit = (commitment: CommitmentDraft) => {
    if (!deal) return;
    const nextProbability = DEFAULT_PROBABILITY_BY_STAGE.committed;
    setProbability(String(nextProbability));
    dealMutation.mutate(
      { stage: "committed", probabilityPercentage: nextProbability, commitment },
      {
        onSuccess: () => {
          setCommitOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["commitments", startupId] });
          toast.success("Commitment recorded against the round");
        },
      },
    );
  };

  // A closed or cancelled raise can't take the deal, but the one it already
  // sits in stays selectable so the control always shows where it is.
  const roundOptions = useMemo(
    () =>
      rounds
        .filter((round) => round.id === deal?.roundId || OPEN_ROUND_STATUSES.includes(round.status))
        .map((round) => ({
          value: round.id,
          label: `${round.roundName} · ${ROUND_STATUS_LABELS[round.status]}`,
        })),
    [rounds, deal?.roundId],
  );

  const currentIndex = deal ? PROGRESSION.findIndex((stage) => stage.id === deal.stage) : -1;
  const investor = deal?.investor;

  const facts = deal
    ? [
        {
          label: "Type",
          value: investor?.investorType
            ? INVESTOR_TYPE_LABELS[investor.investorType as InvestorType]
            : "—",
        },
        { label: "Sector", value: investor?.sectorFocus ?? "—" },
        { label: "Writes at", value: investor?.investmentStagePreference ?? "—" },
        { label: "Source", value: investor?.source ?? "—" },
        { label: "Added", value: formatDateTime(deal.createdAt) },
        {
          label: "Last touch",
          value: signals.lastTouch ? formatDaysAgo(signals.daysQuiet) : "Never",
        },
        { label: "In stage", value: formatDuration(signals.daysInStage) },
      ]
    : [];

  const weighted =
    deal && deal.expectedAmount != null
      ? deal.expectedAmount * ((deal.probabilityPercentage ?? 0) / 100)
      : null;

  return (
    <>
      <Sheet open={deal !== null} onOpenChange={onOpenChange}>
        <SheetContent>
          {deal && investor && (
            <>
              <SheetHeader>
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-sm font-semibold text-primary">
                    {getInitials(investor.fullName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="truncate">{investor.fullName}</SheetTitle>
                    <SheetDescription className="truncate">
                      {investor.ventureFirm ?? "Independent"}
                      {investor.email ? ` · ${investor.email}` : ""}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="flex flex-wrap items-center gap-2">
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

              <section aria-label="Deal stage" className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold">Stage</h3>
                  {canUpdate && (
                    <Button
                      type="button"
                      size="sm"
                      variant={deal.stage === "passed" ? "outline" : "ghost"}
                      className={cn(deal.stage !== "passed" && "text-muted-foreground")}
                      onClick={() => moveToStage(deal.stage === "passed" ? "sourced" : "passed")}
                    >
                      {deal.stage === "passed" ? "Reopen deal" : "Mark as passed"}
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {PROGRESSION.map((stage, index) => {
                    const isCurrent = stage.id === deal.stage;
                    const isDone = currentIndex >= 0 && index < currentIndex;
                    return (
                      <button
                        key={stage.id}
                        type="button"
                        disabled={!canUpdate || dealMutation.isPending}
                        onClick={() => moveToStage(stage.id)}
                        aria-current={isCurrent ? "step" : undefined}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                          isCurrent
                            ? "border-primary bg-primary/10 font-medium text-foreground"
                            : isDone
                              ? "border-border/70 bg-surface/60 text-muted-foreground"
                              : "border-dashed border-border/70 text-muted-foreground",
                          canUpdate && !isCurrent && "hover:border-primary/50 hover:text-foreground",
                          !canUpdate && "cursor-default",
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", stage.dotClass)} />
                        {stage.label}
                      </button>
                    );
                  })}
                </div>
                {deal.stage === "passed" && (
                  <p className="text-xs text-destructive">
                    This investor passed. Reopening drops them back to Sourced.
                  </p>
                )}
              </section>

              <section aria-label="Deal economics" className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="deal-amount">Expected amount</Label>
                  <Input
                    id="deal-amount"
                    type="number"
                    min={0}
                    step={1000}
                    placeholder="250000"
                    disabled={!canUpdate}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    onBlur={commitAmount}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="deal-probability">Probability %</Label>
                  <Input
                    id="deal-probability"
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    disabled={!canUpdate}
                    value={probability}
                    onChange={(event) => setProbability(event.target.value)}
                    onBlur={commitProbability}
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">Weighted</span>
                  <div className="flex h-9 items-center rounded-md border border-border/70 bg-surface/50 px-3 font-mono text-sm tabular-nums text-muted-foreground">
                    {weighted == null ? "—" : formatCompactUsd(Math.round(weighted))}
                  </div>
                </div>
              </section>

              {/* A priced round does not happen without a lead, and "have we
                  got one yet" was previously unanswerable anywhere. */}
              <label className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface/50 px-3 py-2 text-sm">
                <Checkbox
                  checked={deal.isLead}
                  disabled={!canUpdate}
                  onChange={() => dealMutation.mutate({ isLead: !deal.isLead })}
                  aria-label="Leading this round"
                />
                <span className="flex items-center gap-1.5">
                  <Crown className="h-3.5 w-3.5 text-warning" />
                  Leading this round
                </span>
              </label>

              <section aria-label="Deal ownership" className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="deal-owner">Owner</Label>
                  <Select
                    id="deal-owner"
                    disabled={!canUpdate}
                    value={deal.ownerId ?? ""}
                    onValueChange={(value) => dealMutation.mutate({ ownerId: value || null })}
                    options={[
                      { value: "", label: "Unassigned" },
                      ...(membersQuery.data ?? []).map((member) => ({
                        value: member.id,
                        label: member.user
                          ? `${member.user.firstName} ${member.user.lastName}`.trim()
                          : (member.invitedEmail ?? "Pending"),
                      })),
                    ]}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="deal-priority">Priority</Label>
                  <Select
                    id="deal-priority"
                    disabled={!canUpdate}
                    value={deal.priority ?? ""}
                    onValueChange={(value) =>
                      dealMutation.mutate({ priority: (value || null) as Priority | null })
                    }
                    options={[
                      { value: "", label: "Unset" },
                      ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })),
                    ]}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="deal-fit">Investor fit</Label>
                  <Input
                    id="deal-fit"
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    placeholder="0–100"
                    disabled={!canUpdate}
                    value={investorFitScore}
                    onChange={(event) => setInvestorFitScore(event.target.value)}
                    onBlur={commitInvestorFitScore}
                  />
                </div>
              </section>

                      {/* A deal in a round that later closes would otherwise be
                  stranded — the only way out was delete-and-recreate, which
                  throws away its stage history. */}
              {roundOptions.length > 1 && (
                <section aria-label="Fundraising round" className="space-y-1.5">
                  <Label htmlFor="deal-round">Round</Label>
                  <Select
                    id="deal-round"
                    disabled={!canUpdate}
                    value={deal.roundId}
                    onValueChange={(value) => {
                      if (value === deal.roundId) return;
                      dealMutation.mutate(
                        { roundId: value },
                        {
                          onSuccess: () => {
                            // The deal now belongs to a round this board isn't
                            // showing, so keeping the sheet open would leave a
                            // card on screen that no longer exists behind it.
                            toast.success("Deal moved to another round");
                            onOpenChange(false);
                          },
                        },
                      );
                    }}
                    options={roundOptions}
                  />
                </section>
              )}

              <TaskList startupId={startupId} pipelineId={deal.id} />

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-surface/50 p-3 text-sm sm:grid-cols-3">
                {facts.map((fact) => (
                  <div key={fact.label} className="min-w-0">
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {fact.label}
                    </dt>
                    <dd className="truncate text-foreground">{fact.value}</dd>
                  </div>
                ))}
              </dl>

              {investor.notes && (
                <p className="whitespace-pre-wrap rounded-xl border border-border/70 bg-surface/50 p-3 text-sm text-muted-foreground">
                  {investor.notes}
                </p>
              )}

              <div>
                <h3 className="mb-2 font-display text-sm font-semibold">Interaction history</h3>
                {/* The sheet itself scrolls now that it's full-height, so the
                    timeline no longer needs its own bounded scroll area. */}
                <InteractionTimeline
                  logs={logs}
                  stageEvents={stageEventsQuery.data ?? []}
                  authorNames={authorNames}
                  // Logs are the investor's, not the deal's — this marks the
                  // ones that actually belong to a different deal.
                  currentPipelineId={deal.id}
                  // Same guard as InvestorDetailDialog: a disabled query's
                  // isPending never flips to false on its own.
                  isLoading={
                    logsQuery.isPending ||
                    (stageEventsQuery.isPending && stageEventsQuery.fetchStatus !== "idle")
                  }
                  onEdit={(log) => {
                    setEditingLog(log);
                    setLogOpen(true);
                  }}
                  onDelete={setPendingLogDelete}
                />
              </div>

              {canDelete && (
                <SheetFooter className="sm:justify-start">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onRemove(deal)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove from pipeline
                  </Button>
                </SheetFooter>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <LogInteractionDialog
        open={logOpen}
        onOpenChange={(open) => {
          setLogOpen(open);
          if (!open) setEditingLog(null);
        }}
        investorName={investor?.fullName ?? ""}
        log={editingLog}
        isSubmitting={saveLogMutation.isPending}
        onSubmit={(values) => saveLogMutation.mutate(values)}
      />

      <Dialog
        open={pendingLogDelete !== null}
        onOpenChange={(open) => !open && setPendingLogDelete(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this interaction?</DialogTitle>
            <DialogDescription>
              The entry is deleted permanently, along with any follow-up date it carried.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingLogDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteLogMutation.isPending}
              onClick={() => pendingLogDelete && deleteLogMutation.mutate(pendingLogDelete)}
            >
              {deleteLogMutation.isPending ? "Removing…" : "Remove interaction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PassReasonDialog
        open={passReasonOpen}
        investorName={investor?.fullName ?? ""}
        isSubmitting={dealMutation.isPending}
        onCancel={() => setPassReasonOpen(false)}
        onConfirm={confirmPass}
      />

      <CommitDialog
        open={commitOpen}
        investorName={investor?.fullName ?? ""}
        roundName={roundName}
        suggestedAmount={deal?.expectedAmount ?? null}
        isSubmitting={dealMutation.isPending}
        onCancel={() => setCommitOpen(false)}
        onConfirm={confirmCommit}
      />
    </>
  );
}
