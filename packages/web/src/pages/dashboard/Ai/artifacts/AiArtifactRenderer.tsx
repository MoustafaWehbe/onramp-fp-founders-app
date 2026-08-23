import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { AlertTriangle, Calendar, CalendarClock, Check, CheckCircle2, Clipboard, FileCheck2, Flame, GitCompareArrows, KanbanSquare, ListChecks, ListTodo, Loader2, Mail, MessageSquareText, ShieldAlert, TrendingUp, UserRound, UsersRound, X, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Markdown } from "../../../../components/shared/Markdown";
import { Button } from "../../../../components/ui/button";
import { apiErrorMessage } from "../../../../lib/api-error";
import { approveAiAction, rejectAiAction, type AiArtifact } from "../../../../lib/ai-api";
import { cn } from "../../../../lib/utils";

const sourceAnswer = z.object({
  answer: z.string().min(1).max(20_000),
  sources: z.array(z.object({ label: z.string().min(1).max(300), excerpt: z.string().max(1_500).nullable() })).max(20),
});
const comparison = z.object({
  title: z.string().min(1).max(160),
  fields: z.array(z.object({ label: z.string().min(1).max(120), left: z.string().max(2_000), right: z.string().max(2_000), changed: z.boolean() })).min(1).max(30),
});
const emailDraft = z.object({ subject: z.string().min(1).max(240), body: z.string().min(1).max(20_000), contextLabel: z.string().min(1).max(300), missingInvestorContext: z.boolean() });
const meetingBrief = z.object({ title: z.string().min(1).max(240), talkingPoints: z.array(z.string().min(1).max(1_000)).min(1).max(10), contextLabel: z.string().min(1).max(300), missingInvestorContext: z.boolean() });
const forecast = z.object({
  roundName: z.string().min(1).max(200),
  currency: z.string().min(1).max(10),
  targetAmount: z.number().nonnegative(),
  committedToDate: z.number().nonnegative(),
  softPipeline: z.number().nonnegative(),
  projectedDaysToClose: z.number().int().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  insufficientData: z.boolean(),
  inputs: z.object({
    windowDays: z.number().int(),
    stageEventCount: z.number().int(),
    overallConversionRate: z.number().nullable(),
    cycleTimeDays: z.number().nullable(),
    newDealsPerDay: z.number(),
    averageCheckSize: z.number().nullable(),
  }),
});

const investorBrief = z.object({
  investorId: z.string().guid(),
  fullName: z.string().min(1).max(200),
  ventureFirm: z.string().max(200).nullable(),
  investorType: z.string().max(50).nullable(),
  sectorFocus: z.string().max(200).nullable(),
  description: z.string().max(2000).nullable(),
  checkSizeMin: z.number().nullable(),
  checkSizeMax: z.number().nullable(),
  stage: z.string().nullable(),
  daysInStage: z.number().int().nullable(),
  lastInteractions: z.array(z.object({ type: z.string(), subject: z.string().nullable(), interactionDate: z.string().nullable() })).max(5),
});
const focusList = z.object({
  roundId: z.string().guid().nullable(),
  deals: z.array(z.object({
    investorId: z.string(),
    investorName: z.string(),
    stage: z.string(),
    reason: z.enum(["overdue", "today", "missing", "quiet", "priority"]),
    daysQuiet: z.number().int(),
    nextTaskDueDate: z.string().nullable(),
  })).max(15),
});
const pipelineBoard = z.object({
  stages: z.array(z.object({ stage: z.string(), count: z.number().int(), totalValue: z.number() })).max(10),
});
const taskList = z.object({
  tasks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string(),
    dueDate: z.string().nullable(),
    assigned: z.boolean(),
    assigneeName: z.string().nullable(),
    investor: z.object({ id: z.string(), fullName: z.string(), ventureFirm: z.string().nullable() }),
    round: z.object({ id: z.string(), roundName: z.string(), status: z.string() }),
    pipelineStage: z.string(),
  })).max(20),
});

const actionProposal = z.object({
  actionId: z.string().guid(),
  actionType: z.enum(["create_task", "log_interaction", "schedule_meeting", "send_investor_email", "update_deal_stage", "update_task_status"]),
  status: z.enum(["proposed", "approved", "executed", "rejected", "failed", "expired"]),
  payload: z.record(z.string(), z.unknown()),
  expiresAt: z.string(),
});

export function AiArtifactRenderer({ startupId, artifact, onAskFollowup }: { startupId: string; artifact: AiArtifact; onAskFollowup?: (prompt: string) => void }) {
  if (artifact.type === "source_answer.v1") {
    const parsed = sourceAnswer.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    return (
      <ArtifactShell icon={FileCheck2} title={artifact.title ?? "Grounded answer"}>
        <Markdown>{parsed.data.answer}</Markdown>
        {parsed.data.sources.length > 0 && <SourceList sources={parsed.data.sources} />}
      </ArtifactShell>
    );
  }

  if (artifact.type === "comparison.v1") {
    const parsed = comparison.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    return (
      <ArtifactShell icon={GitCompareArrows} title={parsed.data.title}>
        <dl className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {parsed.data.fields.map((field) => (
            <div key={field.label} className="grid grid-cols-3 gap-2 bg-background/40 px-3 py-2 text-xs">
              <dt className="font-medium text-muted-foreground">{field.label}</dt>
              <dd className="text-foreground/80">{field.left}</dd>
              <dd className={cn(field.changed && "font-medium text-primary")}>{field.right}</dd>
            </div>
          ))}
        </dl>
      </ArtifactShell>
    );
  }

  if (artifact.type === "email_draft.v1") {
    const parsed = emailDraft.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    return (
      <ArtifactShell
        icon={Mail}
        title={artifact.title ?? "Follow-up draft"}
        action={<CopyButton value={`Subject: ${parsed.data.subject}\n\n${parsed.data.body}`} />}
      >
        <p className="text-xs text-muted-foreground">{parsed.data.contextLabel}</p>
        <p className="mt-3 text-sm font-medium text-foreground">Subject: {parsed.data.subject}</p>
        <Markdown className="mt-2">{parsed.data.body}</Markdown>
      </ArtifactShell>
    );
  }

  if (artifact.type === "meeting_brief.v1") {
    const parsed = meetingBrief.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    return (
      <ArtifactShell
        icon={UsersRound}
        title={parsed.data.title}
        action={<CopyButton value={`${parsed.data.title}\n\n${parsed.data.talkingPoints.map((point) => `• ${point}`).join("\n")}`} />}
      >
        <p className="text-xs text-muted-foreground">{parsed.data.contextLabel}</p>
        <ul className="mt-3 space-y-1.5">
          {parsed.data.talkingPoints.map((point, index) => (
            <li key={index} className="flex items-start gap-2 text-sm leading-relaxed text-foreground/90">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
              {point}
            </li>
          ))}
        </ul>
      </ArtifactShell>
    );
  }

  if (artifact.type === "forecast.v1") {
    const parsed = forecast.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    const data = parsed.data;
    const format = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: data.currency, maximumFractionDigits: 0 }).format(amount);
    const progressPct = data.targetAmount > 0 ? Math.min(100, Math.round((data.committedToDate / data.targetAmount) * 100)) : 0;
    const confidenceStyle = data.confidence === "high" ? "bg-success/15 text-success" : data.confidence === "medium" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground";
    return (
      <ArtifactShell icon={TrendingUp} title={`${data.roundName} forecast`}>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{format(data.committedToDate)} committed of {format(data.targetAmount)}</span>
          <span className="font-medium text-foreground">{progressPct}%</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-background/60">
          <div className="h-full rounded-full bg-primary" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">+ {format(data.softPipeline)} weighted soft pipeline</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-background/60 px-2.5 py-1 text-xs font-medium text-foreground">
            {data.projectedDaysToClose !== null ? `~${data.projectedDaysToClose} days to close` : "Not enough data to project"}
          </span>
          <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium capitalize", confidenceStyle)}>{data.confidence} confidence</span>
          {data.insufficientData && <span className="text-[11px] text-muted-foreground">Thin history — treat as a rough signal, not a promise.</span>}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border/60 pt-3 text-[11px] sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Stage events (180d)</dt><dd className="text-foreground">{data.inputs.stageEventCount}</dd></div>
          <div><dt className="text-muted-foreground">New deals / day</dt><dd className="text-foreground">{data.inputs.newDealsPerDay}</dd></div>
          <div><dt className="text-muted-foreground">Sourced → committed</dt><dd className="text-foreground">{data.inputs.overallConversionRate !== null ? `${Math.round(data.inputs.overallConversionRate * 100)}%` : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Typical cycle time</dt><dd className="text-foreground">{data.inputs.cycleTimeDays !== null ? `${data.inputs.cycleTimeDays} days` : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Average check</dt><dd className="text-foreground">{data.inputs.averageCheckSize !== null ? format(data.inputs.averageCheckSize) : "—"}</dd></div>
        </dl>
      </ArtifactShell>
    );
  }

  if (artifact.type === "action_proposal.v1") {
    const parsed = actionProposal.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    return <ActionProposalCard key={parsed.data.actionId} startupId={startupId} proposal={parsed.data} />;
  }

  if (artifact.type === "investor_brief.v1") {
    const parsed = investorBrief.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    const data = parsed.data;
    const checkSize = data.checkSizeMin !== null || data.checkSizeMax !== null
      ? `$${(data.checkSizeMin ?? 0).toLocaleString()}${data.checkSizeMax !== null ? `–$${data.checkSizeMax.toLocaleString()}` : "+"}`
      : null;
    return (
      <ArtifactShell icon={UserRound} title={data.fullName}>
        <div className="flex flex-wrap items-center gap-1.5">
          {data.ventureFirm && <span className="text-xs text-muted-foreground">{data.ventureFirm}</span>}
          {data.stage && (
            <span className="rounded-full bg-background/60 px-2 py-0.5 text-[11px] font-medium text-foreground">
              {data.stage.replace(/_/g, " ")}{data.daysInStage !== null ? ` · ${data.daysInStage}d` : ""}
            </span>
          )}
          {data.sectorFocus && <span className="rounded-full bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">{data.sectorFocus}</span>}
          {checkSize && <span className="rounded-full bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">{checkSize}</span>}
        </div>
        {data.description && <p className="mt-2.5 text-sm text-foreground/90">{data.description}</p>}
        {data.lastInteractions.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-border/60 pt-2.5">
            {data.lastInteractions.map((log, index) => (
              <li key={index} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium capitalize text-foreground/80">{log.type}</span>
                {log.subject && <span className="truncate">{log.subject}</span>}
                {log.interactionDate && <span className="ml-auto shrink-0">{new Date(log.interactionDate).toLocaleDateString()}</span>}
              </li>
            ))}
          </ul>
        )}
        {onAskFollowup && (
          <div className="mt-3 flex gap-2 border-t border-border/60 pt-3">
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => onAskFollowup(`Draft a follow-up email to ${data.fullName}.`)}>
              <Mail className="h-3 w-3" /> Draft email
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => onAskFollowup(`Draft a meeting invite to ${data.fullName}.`)}>
              <Calendar className="h-3 w-3" /> Schedule
            </Button>
          </div>
        )}
      </ArtifactShell>
    );
  }

  if (artifact.type === "focus_list.v1") {
    const parsed = focusList.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    return (
      <ArtifactShell icon={Flame} title="Today's focus">
        <ul className="divide-y divide-border/60">
          {parsed.data.deals.map((deal) => (
            <li key={deal.investorId} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{deal.investorName}</p>
                <p className="text-[11px] text-muted-foreground">{FOCUS_REASON_LABELS[deal.reason]} · {deal.stage.replace(/_/g, " ")}</p>
              </div>
              {onAskFollowup && (
                <Button size="sm" variant="ghost" className="h-7 shrink-0 gap-1.5 text-xs" onClick={() => onAskFollowup(`Draft a task to follow up with ${deal.investorName}.`)}>
                  <ListChecks className="h-3 w-3" /> Task
                </Button>
              )}
            </li>
          ))}
        </ul>
      </ArtifactShell>
    );
  }

  if (artifact.type === "pipeline_board.v1") {
    const parsed = pipelineBoard.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    const stages = parsed.data.stages.filter((stage) => stage.count > 0);
    return (
      <ArtifactShell icon={KanbanSquare} title="Pipeline">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {stages.map((stage) => (
            <div key={stage.stage} className="rounded-lg bg-background/60 p-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{stage.stage.replace(/_/g, " ")}</p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">{stage.count}</p>
              {stage.totalValue > 0 && <p className="text-[11px] text-muted-foreground">${stage.totalValue.toLocaleString()}</p>}
            </div>
          ))}
        </div>
      </ArtifactShell>
    );
  }

  if (artifact.type === "task_list.v1") {
    const parsed = taskList.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    return (
      <ArtifactShell icon={ListTodo} title="Tasks">
        <ul className="divide-y divide-border/60">
          {parsed.data.tasks.map((task) => {
            const overdue = task.status === "open" && task.dueDate !== null && new Date(task.dueDate).getTime() < Date.now();
            return (
              <li key={task.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className={cn("truncate text-sm font-medium", task.status === "completed" ? "text-muted-foreground line-through" : "text-foreground")}>{task.title}</p>
                  <p className="truncate text-xs font-medium text-foreground/75">
                    {task.investor.fullName}{task.investor.ventureFirm ? ` · ${task.investor.ventureFirm}` : ""}
                  </p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span>{task.round.roundName}</span>
                    <span>· {task.pipelineStage.replace(/_/g, " ")}</span>
                    <span className="capitalize">{task.priority}</span>
                    {task.dueDate && (
                      <span className={cn("inline-flex items-center gap-0.5", overdue && "text-destructive")}>
                        {overdue ? <AlertTriangle className="h-2.5 w-2.5" /> : <CalendarClock className="h-2.5 w-2.5" />}
                        {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    {!task.assigned && <span>· Unassigned</span>}
                    {task.assigneeName && <span>· {task.assigneeName}</span>}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </ArtifactShell>
    );
  }

  return <UnsupportedArtifact />;
}

const FOCUS_REASON_LABELS: Record<z.infer<typeof focusList>["deals"][number]["reason"], string> = {
  overdue: "Overdue follow-up",
  today: "Due today",
  missing: "No open task",
  quiet: "Gone quiet",
  priority: "High priority",
};

const ACTION_TYPE_META: Record<z.infer<typeof actionProposal>["actionType"], { label: string; icon: LucideIcon }> = {
  create_task: { label: "Task", icon: ListChecks },
  log_interaction: { label: "Interaction log", icon: MessageSquareText },
  schedule_meeting: { label: "Meeting", icon: Calendar },
  send_investor_email: { label: "Email", icon: Mail },
  update_deal_stage: { label: "Stage change", icon: GitCompareArrows },
  update_task_status: { label: "Task update", icon: CheckCircle2 },
};

/** Primary fields shown as the card's heading/body per action type; everything else in the payload falls into the compact key/value list below. */
const ACTION_PRIMARY_FIELDS: Record<string, { heading?: string; body?: string }> = {
  create_task: { heading: "title", body: "description" },
  log_interaction: { heading: "subject", body: "description" },
  schedule_meeting: { heading: "subject", body: "description" },
  send_investor_email: { heading: "subject", body: "body" },
  update_deal_stage: { body: "reason" },
  update_task_status: {},
};

function formatFieldLabel(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  return String(value);
}

function ActionProposalCard({ startupId, proposal }: { startupId: string; proposal: z.infer<typeof actionProposal> }) {
  const [status, setStatus] = useState(proposal.status);
  const [resultSummary, setResultSummary] = useState<string | null>(null);
  const meta = ACTION_TYPE_META[proposal.actionType];
  const primary = ACTION_PRIMARY_FIELDS[proposal.actionType] ?? {};
  const isExpired = status === "proposed" && new Date(proposal.expiresAt).getTime() < Date.now();

  const approveMutation = useMutation({
    mutationFn: () => approveAiAction(startupId, proposal.actionId),
    onSuccess: ({ action, result }) => {
      setStatus(action.status);
      if (action.status === "executed") {
        const summary =
          proposal.actionType === "send_investor_email" ? "Sent" :
          proposal.actionType === "schedule_meeting" ? "Scheduled" :
          proposal.actionType === "create_task" ? "Task created" :
          proposal.actionType === "update_task_status" ? "Task updated" :
          proposal.actionType === "log_interaction" ? "Logged" : "Stage updated";
        setResultSummary(summary);
        toast.success(summary);
      } else {
        void result;
      }
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not complete this action")),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectAiAction(startupId, proposal.actionId),
    onSuccess: (action) => setStatus(action.status),
    onError: (error) => toast.error(apiErrorMessage(error, "Could not discard this proposal")),
  });

  const entries = Object.entries(proposal.payload).filter(([key]) => key !== primary.heading && key !== primary.body);
  const headingValue = primary.heading ? proposal.payload[primary.heading] : undefined;
  const bodyValue = primary.body ? proposal.payload[primary.body] : undefined;

  return (
    <ArtifactShell icon={meta.icon} title={`${meta.label} · ${status === "proposed" && isExpired ? "expired" : status}`}>
      {typeof headingValue === "string" && headingValue && <p className="text-sm font-medium text-foreground">{headingValue}</p>}
      {typeof bodyValue === "string" && bodyValue && <Markdown className="mt-1.5 text-sm">{bodyValue}</Markdown>}

      {entries.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-3">
          {entries.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-muted-foreground">{formatFieldLabel(key)}</dt>
              <dd className="truncate text-foreground">{formatFieldValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
        {status === "proposed" && !isExpired && (
          <>
            <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending || rejectMutation.isPending}>
              {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Approve
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-muted-foreground" onClick={() => rejectMutation.mutate()} disabled={approveMutation.isPending || rejectMutation.isPending}>
              <X className="h-3 w-3" /> Discard
            </Button>
          </>
        )}
        {status === "proposed" && isExpired && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><XCircle className="h-3.5 w-3.5" /> This proposal expired — ask the copilot to draft it again.</span>
        )}
        {status === "executed" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> {resultSummary ?? "Done"}</span>
        )}
        {status === "rejected" && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><XCircle className="h-3.5 w-3.5" /> Discarded</span>}
        {status === "expired" && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><XCircle className="h-3.5 w-3.5" /> Expired</span>}
        {status === "failed" && <span className="inline-flex items-center gap-1.5 text-xs text-destructive"><ShieldAlert className="h-3.5 w-3.5" /> Failed — try approving again or ask the copilot to redraft it.</span>}
      </div>
    </ArtifactShell>
  );
}

function ArtifactShell({ icon: Icon, title, action, children }: { icon: LucideIcon; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-2 max-w-full rounded-xl border border-border/60 bg-card/60 p-4 text-left shadow-xs">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h3 className="flex-1 truncate text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SourceList({ sources }: { sources: Array<{ label: string; excerpt: string | null }> }) {
  return (
    <details className="group mt-3 rounded-lg border border-border/60 bg-background/40 text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-medium text-muted-foreground marker:content-none">
        <span>{sources.length} verified source{sources.length === 1 ? "" : "s"}</span>
        <span className="text-[10px] text-muted-foreground/70 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <ul className="space-y-2 border-t border-border/60 px-3 py-2">
        {sources.map((source, index) => (
          <li key={`${source.label}-${index}`} className="leading-relaxed">
            <span className="font-medium text-foreground/80">{source.label}</span>
            {source.excerpt && <span className="text-muted-foreground"> — {source.excerpt}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      }}
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Clipboard className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function UnsupportedArtifact() {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      This AI result uses an unsupported or invalid display format. The conversation text remains available.
    </div>
  );
}
