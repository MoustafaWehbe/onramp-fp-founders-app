import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarPlus, ChevronDown, Crown, History, LayoutDashboard, Linkedin, ListChecks, Mail, Pencil, Plus, Save, Sparkles, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "../../../components/shared/ConfirmDialog";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import { usePermissions } from "../../../hooks/usePermissions";
import { useGoogleConnectionStatus } from "../../../hooks/useGoogleConnection";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-error";
import {
  createInteractionLog,
  deleteInteractionLog,
  listLogsForInvestor,
  updateInteractionLog,
  type InteractionLog,
} from "../../../lib/interaction-log-api";
import { sendInvestorEmail } from "../../../lib/gmail-api";
import { scheduleMeeting } from "../../../lib/calendar-api";
import { INVESTOR_TYPE_LABELS, updateInvestor, type InvestorType } from "../../../lib/investor-api";
import { DEFAULT_PROBABILITY_BY_STAGE, STAGES, type PipelineStageId } from "../../../lib/mock-data";
import { fetchAllPages } from "../../../lib/pagination";
import {
  listPipelineStageEvents,
  updatePipelineEntry,
  type CommitmentDraft,
  type FocusReason,
  type PipelineEntry,
} from "../../../lib/pipeline-api";
import {
  invalidateDealData,
  invalidateFinancialData,
  invalidateInteractionData,
  invalidateStageData,
  qk,
} from "../../../lib/query-keys";
import { listMembers } from "../../../lib/team-api";
import {
  OPEN_ROUND_STATUSES,
  ROUND_STATUS_LABELS,
  type FundraisingRound,
} from "../../../lib/fundraising-api";
import { PRIORITIES, PRIORITY_LABELS, type Priority } from "../../../lib/task-api";
import { cn, formatCompactMoney, getInitials } from "../../../lib/utils";
import { ComposeEmailDialog, type ComposeFormValues } from "../Investors/ComposeEmailDialog";
import { InteractionTimeline } from "../Investors/InteractionTimeline";
import { LogInteractionDialog, type LogFormValues } from "../Investors/LogInteractionDialog";
import { ScheduleMeetingDialog, type ScheduleFormValues } from "../Investors/ScheduleMeetingDialog";
import { NoteByline } from "../Investors/NoteByline";
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
  focusReason: FocusReason | null;
  /** Named in the commit prompt, so it's clear which raise the money lands in. */
  roundName: string;
  /** Every round this deal could be carried into, plus the one it's in. */
  rounds: FundraisingRound[];
  /** Investors already leading this round, excluding this one. */
  otherLeadNames: string[];
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

function sendEmailErrorMessage(err: unknown): string {
  switch (apiErrorCode(err)) {
    case "INVESTOR_EMAIL_MISSING":
      return "This investor has no email on file.";
    case "GOOGLE_NOT_CONNECTED":
      return "Connect your Google account in Settings to send email.";
    case "GOOGLE_NEEDS_REAUTH":
      return "Your Google connection needs to be reconnected — see Settings.";
    case "GMAIL_SEND_FAILED":
      return "Google rejected the send. Please try again.";
    default:
      return apiErrorMessage(err, "Could not send the email");
  }
}

function scheduleMeetingErrorMessage(err: unknown): string {
  switch (apiErrorCode(err)) {
    case "INVESTOR_EMAIL_MISSING":
      return "This investor has no email on file.";
    case "PIPELINE_MISMATCH":
      return "That pipeline entry belongs to a different contact.";
    case "GOOGLE_NOT_CONNECTED":
      return "Connect your Google account in Settings to schedule meetings.";
    case "GOOGLE_NEEDS_REAUTH":
    case "GOOGLE_INSUFFICIENT_SCOPE":
      return "Your Google connection needs to be reconnected — see Settings.";
    case "CALENDAR_EVENT_FAILED":
      return "Google rejected the request. Please try again.";
    default:
      return apiErrorMessage(err, "Could not schedule the meeting");
  }
}

export function DealDetailDialog({
  startupId,
  deal,
  signals,
  focusReason,
  roundName,
  rounds,
  otherLeadNames,
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
  const [composeOpen, setComposeOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const googleStatus = useGoogleConnectionStatus();
  const [amount, setAmount] = useState("");
  const [probability, setProbability] = useState("");
  const [investorFitScore, setInvestorFitScore] = useState("");
  const [passReasonOpen, setPassReasonOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "tasks" | "activity">("overview");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDeleteOpen, setNoteDeleteOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Naming the round's lead is a commitment the whole team reads, so it is
  // confirmed in both directions rather than toggled by a stray click.
  const [leadConfirmOpen, setLeadConfirmOpen] = useState(false);

  const investorId = deal?.investor.id ?? null;

  // Reset the editable fields whenever a different deal is opened, so a stale
  // draft never leaks onto the next investor.
  useEffect(() => {
    if (!deal) return;
    setActiveTab("overview");
    setAmount(deal.expectedAmount == null ? "" : String(deal.expectedAmount));
    setProbability(deal.probabilityPercentage == null ? "" : String(deal.probabilityPercentage));
    setInvestorFitScore(deal.investorFitScore == null ? "" : String(deal.investorFitScore));
    setNoteDraft(deal.investor.notes ?? "");
    setNoteEditing(false);
    setNoteDeleteOpen(false);
    setLeadConfirmOpen(false);
    setDetailsOpen(false);
  }, [deal]);

  const logsQuery = useQuery({
    queryKey: qk.logsForInvestor(startupId, investorId),
    queryFn: () =>
      fetchAllPages((page, limit) =>
        listLogsForInvestor(startupId, investorId!, { page, limit }),
      ).then((data) => ({ data })),
    enabled: investorId !== null,
  });

  // Who added this deal and who's moved its stage since — shown alongside
  // the logged interactions so "what happened" always answers "who did it".
  const stageEventsQuery = useQuery({
    queryKey: qk.stageEvents(startupId, deal?.id),
    queryFn: () => listPipelineStageEvents(startupId, deal!.id),
    enabled: deal !== null,
  });

  // Logs carry only a createdBy user id; the members list puts a name on each.
  const membersQuery = useQuery({
    queryKey: qk.members(startupId),
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
    invalidateStageData(queryClient, startupId);
    invalidateInteractionData(queryClient, startupId);
  };

  const dealMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updatePipelineEntry>[2]) =>
      updatePipelineEntry(startupId, deal!.id, patch),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(logErrorMessage(err, "Could not update the deal")),
  });

  const noteMutation = useMutation({
    mutationFn: (notes: string | null) => updateInvestor(startupId, investorId!, { notes }),
    onSuccess: (_investor, notes) => {
      setNoteDraft(notes ?? "");
      setNoteEditing(false);
      toast.success(notes ? "Investor note saved" : "Investor note removed");
      invalidateDealData(queryClient, startupId);
    },
    onError: (err) => toast.error(logErrorMessage(err, "Could not update the investor note")),
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

  const sendEmailMutation = useMutation({
    mutationFn: (values: ComposeFormValues) =>
      sendInvestorEmail(startupId, investorId!, { pipelineId: deal!.id, ...values }),
    onSuccess: (result) => {
      toast.success(
        result.logCreated
          ? "Email sent and logged"
          : "Email sent — it'll appear in the timeline shortly",
      );
      setComposeOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(sendEmailErrorMessage(err)),
  });

  const scheduleMutation = useMutation({
    mutationFn: (values: ScheduleFormValues) =>
      scheduleMeeting(startupId, investorId!, {
        pipelineId: deal!.id,
        type: values.type,
        startDateTime: values.startDateTime,
        durationMinutes: values.durationMinutes,
        subject: values.subject ?? undefined,
        description: values.description ?? undefined,
      }),
    onSuccess: (result) => {
      toast.success(
        result.logCreated
          ? "Meeting scheduled and logged"
          : "Meeting scheduled — it'll appear in the timeline shortly",
      );
      setScheduleOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(scheduleMeetingErrorMessage(err)),
  });

  const canSendEmail = Boolean(deal?.investor.email) && googleStatus.data?.connected === true;
  const composeDisabledReason = !deal?.investor.email
    ? "This investor has no email on file"
    : googleStatus.data?.connected !== true
      ? "Connect your Google account in Settings to send email"
      : undefined;

  const canSchedule = Boolean(deal?.investor.email) && googleStatus.data?.connected === true;
  const scheduleDisabledReason = !deal?.investor.email
    ? "This investor has no email on file"
    : googleStatus.data?.connected !== true
      ? "Connect your Google account in Settings to schedule meetings"
      : undefined;

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
          invalidateFinancialData(queryClient, startupId);
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
  // Looked up from the deal's own round rather than assumed from whichever
  // round the board happens to be viewing — a deal only shows the wrong
  // currency if it were guessed instead of resolved this way.
  const currency = rounds.find((round) => round.id === deal?.roundId)?.currency ?? "USD";

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

  const recommendation = (() => {
    if (!deal) return null;
    if (deal.stage === "passed") return { title: "Decide whether to reopen this relationship", detail: "This deal is closed and will not appear in the active pipeline.", label: "Review stage", action: () => moveToStage("sourced"), needsGoogle: false };
    if (focusReason === "overdue") return { title: "Complete or reschedule the overdue next step", detail: "This investor is at risk of going cold while an assigned task is overdue.", label: "Review tasks", action: () => setActiveTab("tasks"), needsGoogle: false };
    if (focusReason === "today") return { title: "Follow up today", detail: "A next step is due today. Close it out or set the next commitment.", label: "Review tasks", action: () => setActiveTab("tasks"), needsGoogle: false };
    if (focusReason === "missing") return { title: "Add a clear next step", detail: "This deal has no open task, owner action, or scheduled follow-up.", label: "Add next step", action: () => setActiveTab("tasks"), needsGoogle: false };
    if (focusReason === "quiet") return { title: "Restart the conversation", detail: "There has been no recent interaction with this investor.", label: "Schedule follow-up", action: () => setScheduleOpen(true), needsGoogle: true };
    if (deal.stage === "sourced") return { title: "Make the first approach", detail: "Move this investor from research into an active conversation.", label: "Schedule outreach", action: () => setScheduleOpen(true), needsGoogle: true };
    return { title: "Keep the momentum visible", detail: "Schedule the next conversation and make sure a next step is assigned.", label: "Schedule call", action: () => setScheduleOpen(true), needsGoogle: true };
  })();

  return (
    <>
      <Sheet open={deal !== null} onOpenChange={onOpenChange}>
        <SheetContent className="max-w-2xl gap-0 p-0 sm:max-w-2xl sm:gap-0 sm:p-0">
          {deal && investor && (
            <>
              <SheetHeader className="border-b border-border/70 bg-card/95 px-5 pb-5 pt-6 sm:px-7">
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

              <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-5 py-3 sm:px-7">
                {canCreate && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canSendEmail}
                    title={composeDisabledReason}
                    onClick={() => setComposeOpen(true)}
                  >
                    <Mail className="h-3.5 w-3.5" /> Send email
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
                    disabled={!canSchedule}
                    title={scheduleDisabledReason}
                    onClick={() => setScheduleOpen(true)}
                  >
                    <CalendarPlus className="h-4 w-4" />
                    Schedule
                  </Button>
                )}
              </div>

              <nav className="flex gap-1 border-b border-border/70 px-5 pt-2 sm:px-7" aria-label="Investor details">
                {([
                  { id: "overview", label: "Overview", icon: LayoutDashboard },
                  { id: "tasks", label: "Tasks", icon: ListChecks },
                  { id: "activity", label: "Activity", icon: History },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={cn(
                      "relative flex items-center gap-2 px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                      activeTab === id && "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </nav>

              <div className="space-y-6 px-5 py-6 sm:px-7">
              {activeTab === "overview" && <>

              {recommendation && (
                <section aria-label="Recommended next action" className="relative overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.055] p-4">
                  <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
                  <div className="relative flex flex-wrap items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><Sparkles className="h-5 w-5" /></div>
                    <div className="min-w-48 flex-1"><p className="font-mono text-[10px] uppercase tracking-widest text-primary">Recommended next action</p><h3 className="mt-1 text-sm font-semibold">{recommendation.title}</h3><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{recommendation.detail}</p></div>
                    {canUpdate && <Button type="button" size="sm" disabled={recommendation.needsGoogle && !canSchedule} title={recommendation.needsGoogle ? scheduleDisabledReason : undefined} onClick={recommendation.action}>{recommendation.label}<ArrowRight className="h-3.5 w-3.5" /></Button>}
                  </div>
                </section>
              )}

              <section aria-label="Deal stage" className="space-y-3 rounded-2xl border border-border/70 bg-surface/30 p-4">
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

              <section aria-label="Deal economics" className="grid gap-3">
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
              </section>

              {/* A priced round does not happen without a lead, and "have we
                  got one yet" was previously unanswerable anywhere. */}
              <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors", deal.isLead ? "border-warning/35 bg-warning/[0.07]" : "border-border/70 bg-surface/40")}>
                <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", deal.isLead ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>
                  <Crown className="h-4 w-4" />
                </div>
                <div className="min-w-40 flex-1">
                  <p className="text-sm font-semibold">Round lead</p>
                  <p className="text-xs text-muted-foreground">
                    {deal.isLead
                      ? `${investor.fullName} is leading ${roundName}.`
                      : otherLeadNames.length > 0
                        ? `Currently leading: ${otherLeadNames.join(", ")}.`
                        : "No investor is leading this round yet."}
                  </p>
                </div>
                <button
                  type="button"
                  aria-pressed={deal.isLead}
                  disabled={!canUpdate || dealMutation.isPending}
                  onClick={() => setLeadConfirmOpen(true)}
                  className={cn(
                    "h-8 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                    deal.isLead
                      ? "border-warning/40 bg-warning/15 text-warning hover:bg-warning/20"
                      : "border-border bg-card text-muted-foreground hover:border-warning/40 hover:text-foreground",
                  )}
                >
                  {deal.isLead ? "Lead investor" : "Set as lead"}
                </button>
              </div>

              <section aria-label="Deal ownership" className="grid gap-3 sm:grid-cols-2">
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
              </section>

              <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
                className="flex w-full items-center justify-between rounded-xl border border-border/70 bg-surface/30 px-4 py-3 text-left transition-colors hover:bg-surface/60"
              >
                <span><span className="block text-sm font-semibold">Deal settings and investor profile</span><span className="mt-0.5 block text-xs text-muted-foreground">Probability, fit score, round assignment, and contact metadata</span></span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", detailsOpen && "rotate-180")} />
              </button>

              {detailsOpen && <>
              <section aria-label="Advanced deal settings" className="grid gap-3 rounded-xl border border-border/70 bg-surface/30 p-4 sm:grid-cols-3">
                <div className="space-y-1.5"><Label htmlFor="deal-probability">Probability %</Label><Input id="deal-probability" type="number" min={0} max={100} step={5} disabled={!canUpdate} value={probability} onChange={(event) => setProbability(event.target.value)} onBlur={commitProbability} /></div>
                <div className="space-y-1.5"><Label htmlFor="deal-fit">Investor fit</Label><Input id="deal-fit" type="number" min={0} max={100} step={5} placeholder="0–100" disabled={!canUpdate} value={investorFitScore} onChange={(event) => setInvestorFitScore(event.target.value)} onBlur={commitInvestorFitScore} /></div>
                <div className="space-y-1.5"><span className="text-sm font-medium">Weighted value</span><div className="flex h-9 items-center rounded-md border border-border/70 bg-card px-3 font-mono text-sm tabular-nums text-muted-foreground">{weighted == null ? "—" : formatCompactMoney(Math.round(weighted), currency)}</div></div>
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
              </>}

              <section aria-label="Investor notes" className="rounded-xl border border-border/70 bg-surface/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground"><StickyNote className="h-4 w-4" /></div>
                    <div>
                      <h3 className="text-sm font-semibold">Investor notes</h3>
                      <p className="text-xs text-muted-foreground">Shared contact context, visible anywhere this investor appears.</p>
                    </div>
                  </div>
                  {canUpdate && !noteEditing && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setNoteEditing(true)}>
                      {investor.notes ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      {investor.notes ? "Edit" : "Add note"}
                    </Button>
                  )}
                </div>

                {noteEditing ? (
                  <div className="mt-4 space-y-3">
                    <Textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      placeholder="Add context from conversations, preferences, or relationship history…"
                      maxLength={2000}
                      className="min-h-28 resize-y bg-card"
                      autoFocus
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-muted-foreground">{noteDraft.length}/2000</span>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setNoteDraft(investor.notes ?? ""); setNoteEditing(false); }}>Cancel</Button>
                        <Button type="button" size="sm" disabled={noteMutation.isPending} onClick={() => noteMutation.mutate(noteDraft.trim() || null)}><Save className="h-3.5 w-3.5" />{noteMutation.isPending ? "Saving…" : "Save note"}</Button>
                      </div>
                    </div>
                  </div>
                ) : investor.notes ? (
                  <div className="mt-4">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{investor.notes}</p>
                    <NoteByline contact={investor} authorNames={authorNames} />
                    {canUpdate && <Button type="button" size="sm" variant="ghost" className="mt-3 h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={noteMutation.isPending} onClick={() => setNoteDeleteOpen(true)}><Trash2 className="h-3.5 w-3.5" /> Remove note</Button>}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">No notes have been added for this investor.</p>
                )}
              </section>
              </>}

              {activeTab === "tasks" && (
                <TaskList
                  startupId={startupId}
                  pipelineId={deal.id}
                  dealLabel={investor.fullName}
                />
              )}

              {activeTab === "activity" && <div>
                <div className="mb-5">
                  <h3 className="font-display text-base font-semibold">Activity</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Interactions and stage changes, newest first.</p>
                </div>
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
              </div>}

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
              </div>
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

      <ComposeEmailDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        investorName={investor?.fullName ?? ""}
        investorEmail={investor?.email ?? ""}
        isSubmitting={sendEmailMutation.isPending}
        onSubmit={(values) => sendEmailMutation.mutate(values)}
      />

      <ScheduleMeetingDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        investorName={investor?.fullName ?? ""}
        investorEmail={investor?.email ?? ""}
        isSubmitting={scheduleMutation.isPending}
        onSubmit={(values) => scheduleMutation.mutate(values)}
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

      <ConfirmDialog
        open={leadConfirmOpen}
        onOpenChange={setLeadConfirmOpen}
        title={
          deal?.isLead
            ? `Remove ${investor?.fullName ?? "this investor"} as lead?`
            : `Make ${investor?.fullName ?? "this investor"} the lead?`
        }
        description={
          deal?.isLead
            ? `${roundName} will show no lead from this investor. Nothing else about the deal changes, and you can set it back at any time.`
            : otherLeadNames.length > 0
              ? `${otherLeadNames.join(", ")} ${otherLeadNames.length === 1 ? "is" : "are"} already marked as leading ${roundName}. Co-leads are allowed — both will be shown to the team.`
              : `The whole team will see this investor as the anchor for ${roundName}. It can be undone at any time.`
        }
        variant={deal?.isLead ? "destructive" : "default"}
        confirmLabel={deal?.isLead ? "Remove as lead" : "Set as lead"}
        pendingLabel="Saving…"
        isPending={dealMutation.isPending}
        onConfirm={() =>
          deal &&
          dealMutation.mutate(
            { isLead: !deal.isLead },
            {
              onSuccess: () => {
                toast.success(deal.isLead ? "Lead investor cleared" : "Lead investor set");
                setLeadConfirmOpen(false);
              },
            },
          )
        }
      />

      <ConfirmDialog
        open={noteDeleteOpen}
        onOpenChange={setNoteDeleteOpen}
        title="Remove this investor note?"
        description="The note is deleted for everyone who can see this contact, along with who wrote it. Logged interactions are not affected."
        confirmLabel="Remove note"
        pendingLabel="Removing…"
        isPending={noteMutation.isPending}
        onConfirm={() => noteMutation.mutate(null, { onSuccess: () => setNoteDeleteOpen(false) })}
      />

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
