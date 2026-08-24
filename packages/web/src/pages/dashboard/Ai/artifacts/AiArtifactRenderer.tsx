import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Calendar, Check, CheckCircle2, GitCompareArrows, ListChecks, Loader2, Mail, MessageSquareText, ShieldAlert, X, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Markdown } from "../../../../components/shared/Markdown";
import { Button } from "../../../../components/ui/button";
import { apiErrorMessage } from "../../../../lib/api-error";
import { approveAiAction, rejectAiAction, type AiArtifact } from "../../../../lib/ai-api";

const actionProposal = z.object({
  actionId: z.string().guid(),
  actionType: z.enum(["create_task", "log_interaction", "schedule_meeting", "send_investor_email", "update_deal_stage", "update_task_status"]),
  status: z.enum(["proposed", "approved", "executed", "rejected", "failed", "expired"]),
  payload: z.record(z.string(), z.unknown()),
  expiresAt: z.string(),
});

// action_proposal.v1 is the only artifact type the AI produces: everything a
// tool merely reads (a briefing, a task list, an investor's context, a
// forecast) is answered in the model's own natural-language text instead of a
// structured card. This one stays because it isn't decorative — it's the
// Approve/Discard UI a human needs to review a drafted task, email, meeting,
// or stage change before anything actually happens.
export function AiArtifactRenderer({ startupId, artifact }: { startupId: string; artifact: AiArtifact }) {
  if (artifact.type === "action_proposal.v1") {
    const parsed = actionProposal.safeParse(artifact.data);
    if (!parsed.success) return <UnsupportedArtifact />;
    return <ActionProposalCard key={parsed.data.actionId} startupId={startupId} proposal={parsed.data} />;
  }

  return <UnsupportedArtifact />;
}

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

function ArtifactShell({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="mt-2 max-w-full rounded-xl border border-border/60 bg-card/60 p-4 text-left shadow-xs">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h3 className="flex-1 truncate text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="mt-3">{children}</div>
    </section>
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
