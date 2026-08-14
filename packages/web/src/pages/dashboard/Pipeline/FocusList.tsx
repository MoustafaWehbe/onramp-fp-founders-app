import { useState } from "react";
import { AlertTriangle, CheckCircle2, Crown, ListPlus, Mail, Plus, Sparkles } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { StageBadge } from "../Investors/StageBadge";
import type { PipelineFocusEntry } from "../../../lib/pipeline-api";
import { cn, formatCompactMoney, getInitials } from "../../../lib/utils";
import { FOCUS_REASON_LABELS, FOCUS_REASON_TONES, formatDaysAgo } from "./deal-signals";

type FocusListProps = {
  items: PipelineFocusEntry[];
  /** The round's own currency — a deal's amount is never assumed to be USD. */
  currency: string;
  canCreate: boolean;
  onOpen: (deal: PipelineFocusEntry) => void;
  onLog: (deal: PipelineFocusEntry) => void;
  /** Sets the next step straight from the row — most of this queue is here for want of one. */
  onAddTask: (deal: PipelineFocusEntry) => void;
};

function dueLabel(nextTaskDueDate: string | null, now = Date.now()): string | null {
  if (!nextTaskDueDate) return null;
  const days = Math.round((new Date(nextTaskDueDate).getTime() - now) / (24 * 60 * 60 * 1000));
  if (days < 0) return `Overdue ${Math.abs(days)}d`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days}d`;
}

export function FocusList({ items, currency, canCreate, onOpen, onLog, onAddTask }: FocusListProps) {
  const [leadsOnly, setLeadsOnly] = useState(false);
  const leadCount = items.filter((deal) => deal.isLead).length;
  const visibleItems = leadsOnly ? items.filter((deal) => deal.isLead) : items;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 px-6 py-14 text-center">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-success/15 text-success">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <p className="font-display text-base font-semibold">Nothing needs chasing</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Every live deal has a next step scheduled in the future, and none have gone quiet.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-label="Deals needing attention">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-warning/15 text-warning">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold">Action queue</h2>
            <p className="text-xs text-muted-foreground">Deals that need a follow-up or a clear next step.</p>
          </div>
        </div>
        <div className="inline-flex items-center gap-1 rounded-xl border border-border/70 bg-surface/60 p-1" role="group" aria-label="Focus filter">
          <button
            type="button"
            aria-pressed={!leadsOnly}
            onClick={() => setLeadsOnly(false)}
            className={cn("rounded-lg px-3 py-1.5 text-sm transition-colors", !leadsOnly ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            All <span className="ml-1 font-mono text-[11px] text-muted-foreground">{items.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={leadsOnly}
            onClick={() => setLeadsOnly(true)}
            className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors", leadsOnly ? "bg-warning/15 font-medium text-warning" : "text-muted-foreground hover:text-foreground")}
          >
            <Crown className="h-3.5 w-3.5" /> Leads
            <span className="font-mono text-[11px] opacity-75">{leadCount}</span>
          </button>
        </div>
      </div>

      {visibleItems.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-warning/10 text-warning"><Crown className="h-5 w-5" /></div>
          <p className="font-display text-base font-semibold">No leads need attention</p>
          <p className="max-w-sm text-sm text-muted-foreground">Your lead investors are up to date. Switch to All to see the rest of the queue.</p>
        </div>
      )}

      {visibleItems.length > 0 && <ul className="grid gap-3 xl:grid-cols-2">
      {visibleItems.map((deal) => {
        const investor = deal.investor;
        const due = dueLabel(deal.nextTaskDueDate);
        const urgent = deal.reason === "overdue";

        return (
          <li
            key={deal.id}
            className={cn(
              "group relative flex flex-wrap items-center gap-3 overflow-hidden rounded-2xl border bg-card p-4 transition-colors hover:border-primary/35 hover:bg-surface/30",
              urgent ? "border-destructive/35 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-destructive" : "border-border/70",
            )}
          >
            <div
              className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-xs font-semibold",
                urgent ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary",
              )}
            >
              {getInitials(investor.fullName)}
            </div>

            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onOpen(deal)}
              className="truncate text-left text-sm font-semibold text-foreground hover:text-primary"
              >
                {investor.fullName}
              </button>
              <div className="truncate text-xs text-muted-foreground">
                {investor.ventureFirm ?? "Independent"}
                {deal.expectedAmount != null && ` · ${formatCompactMoney(deal.expectedAmount, currency)}`}
              </div>
              {deal.isLead && <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-warning/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"><Crown className="h-3 w-3" /> Lead investor</span>}
            </div>

            <div className="flex min-w-0 flex-col items-start gap-1 sm:items-end">
              <StageBadge stageId={deal.stage} />
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]",
                  FOCUS_REASON_TONES[deal.reason],
                )}
              >
                <AlertTriangle className="h-3 w-3" />
                {due ?? FOCUS_REASON_LABELS[deal.reason]}
                {due && deal.daysQuiet > 0 && ` · last ${formatDaysAgo(deal.daysQuiet)}`}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {investor.email && (
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a href={`mailto:${investor.email}`} aria-label={`Email ${investor.fullName}`}>
                    <Mail className="h-4 w-4" />
                  </a>
                </Button>
              )}
              {canCreate && (
                <>
                  <Button size="sm" variant="outline" onClick={() => onLog(deal)}>
                    <Plus className="h-4 w-4" />
                    Log
                  </Button>
                  <Button size="sm" onClick={() => onAddTask(deal)}>
                    <ListPlus className="h-4 w-4" />
                    Task
                  </Button>
                </>
              )}
            </div>
          </li>
        );
      })}
      </ul>}
    </section>
  );
}
