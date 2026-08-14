import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, History, LayoutDashboard, Linkedin, ListChecks, Mail, Plus, Sparkles, StickyNote } from "lucide-react";
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
import { ConfirmDialog } from "../../../components/shared/ConfirmDialog";
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
import { INVESTOR_TYPE_LABELS } from "../../../lib/investor-api";
import { fetchAllPages } from "../../../lib/pagination";
import { listPipelineStageEvents } from "../../../lib/pipeline-api";
import { invalidateInteractionData, qk } from "../../../lib/query-keys";
import { listMembers } from "../../../lib/team-api";
import { cn, getInitials } from "../../../lib/utils";
import { TaskList } from "../Pipeline/TaskList";
import { ComposeEmailDialog, type ComposeFormValues } from "./ComposeEmailDialog";
import { InteractionTimeline } from "./InteractionTimeline";
import { LogInteractionDialog, type LogFormValues } from "./LogInteractionDialog";
import { NoteByline } from "./NoteByline";
import { StageBadge } from "./StageBadge";
import type { InvestorRow } from "./investor-types";

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
  const [composeOpen, setComposeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "tasks" | "activity">("overview");

  const googleStatus = useGoogleConnectionStatus();

  const investorId = investor?.id ?? null;

  useEffect(() => {
    if (investorId) setActiveTab("overview");
  }, [investorId]);

  const logsQuery = useQuery({
    queryKey: qk.logsForInvestor(startupId, investorId),
    queryFn: () =>
      fetchAllPages((page, limit) =>
        listLogsForInvestor(startupId, investorId!, { page, limit }),
      ).then((data) => ({ data })),
    enabled: investorId !== null,
  });

  const pipelineId = investor?.pipelineId ?? null;

  // Only contacts on the board have stage history; a prospect has none yet.
  const stageEventsQuery = useQuery({
    queryKey: qk.stageEvents(startupId, pipelineId),
    queryFn: () => listPipelineStageEvents(startupId, pipelineId!),
    enabled: pipelineId !== null,
  });

  // Logs carry only a createdBy user id. The members list is already cached by
  // the Team page and readable by every role, so reuse it to put a name on each
  // entry rather than showing a raw uuid.
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

  // Logging an interaction is what moves a contact out of Prospects, and it
  // also feeds nextFollowupDate on the list — both come from the list query.
  const invalidate = () => invalidateInteractionData(queryClient, startupId);

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

  const sendEmailMutation = useMutation({
    mutationFn: (values: ComposeFormValues) =>
      sendInvestorEmail(startupId, investorId!, {
        pipelineId: pipelineId ?? undefined,
        ...values,
      }),
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

  const canSendEmail = Boolean(investor?.email) && googleStatus.data?.connected === true;
  const composeDisabledReason = !investor?.email
    ? "This investor has no email on file"
    : googleStatus.data?.connected !== true
      ? "Connect your Google account in Settings to send email"
      : undefined;

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
        <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0 sm:gap-0 sm:p-0">
          {investor && (
            <>
              <DialogHeader className="border-b border-border/70 bg-card px-5 pb-5 pt-6 sm:px-7">
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

              <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-5 py-3 sm:px-7">
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
                  <Button size="sm" onClick={() => { setEditingLog(null); setLogOpen(true); }}>
                    <Plus className="h-4 w-4" /> Log interaction
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

              <nav className="flex gap-1 border-b border-border/70 px-5 pt-2 sm:px-7" aria-label="Investor details">
                {([
                  { id: "overview", label: "Overview", icon: LayoutDashboard },
                  { id: "tasks", label: "Tasks", icon: ListChecks },
                  { id: "activity", label: "Activity", icon: History },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button" onClick={() => setActiveTab(id)} className={cn("relative flex items-center gap-2 px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground", activeTab === id && "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary")}>
                    <Icon className="h-4 w-4" />{label}
                  </button>
                ))}
              </nav>

              <div className="space-y-5 px-5 py-6 sm:px-7">
              {activeTab === "overview" && <>

              <section className="relative overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.055] p-4" aria-label="Recommended next action">
                <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
                <div className="relative flex flex-wrap items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><Sparkles className="h-5 w-5" /></div><div className="min-w-48 flex-1"><p className="font-mono text-[10px] uppercase tracking-widest text-primary">Recommended next action</p><h3 className="mt-1 text-sm font-semibold">{pipelineId ? "Keep the next commitment clear" : "Start the relationship"}</h3><p className="mt-0.5 text-xs text-muted-foreground">{pipelineId ? "Review assigned work or log the latest investor conversation." : "Log your first outreach, then add this contact to the active pipeline when qualified."}</p></div>{canCreate && <Button size="sm" onClick={() => { setEditingLog(null); setLogOpen(true); }}>{pipelineId ? "Log interaction" : "Log outreach"}<ArrowRight className="h-3.5 w-3.5" /></Button>}</div>
              </section>

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

              <section className="rounded-xl border border-border/70 bg-surface/40 p-4"><div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground"><StickyNote className="h-4 w-4" /></div><div><h3 className="text-sm font-semibold">Investor notes</h3><p className="text-xs text-muted-foreground">Shared relationship context for your team.</p></div></div><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{investor.contact.notes || "No notes have been added for this investor."}</p>{investor.contact.notes && <NoteByline contact={investor.contact} authorNames={authorNames} />}</section>
              </>}

              {/* Only a contact already on the board has a deal to attach tasks to. */}
              {activeTab === "tasks" && (pipelineId ? <TaskList startupId={startupId} pipelineId={pipelineId} dealLabel={investor?.name ?? "this investor"} /> : <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center"><ListChecks className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-semibold">Tasks start on the pipeline</p><p className="mt-1 text-xs text-muted-foreground">Add this investor to a fundraising round before assigning deal work.</p></div>)}

              {activeTab === "activity" && <>
              <div className="flex items-center justify-between gap-2">
                <div><h3 className="font-display text-base font-semibold">Activity</h3><p className="mt-1 text-xs text-muted-foreground">Interactions and pipeline changes, newest first.</p></div>
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
              </>}
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

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Remove this interaction?"
        description="The entry is deleted permanently. If it was the only one and the contact isn't on the pipeline board, they move back to Prospects."
        confirmLabel="Remove interaction"
        pendingLabel="Removing…"
        isPending={deleteMutation.isPending}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
      />

      <ComposeEmailDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        investorName={investor?.name ?? ""}
        investorEmail={investor?.email ?? ""}
        isSubmitting={sendEmailMutation.isPending}
        onSubmit={(values) => sendEmailMutation.mutate(values)}
      />
    </>
  );
}
