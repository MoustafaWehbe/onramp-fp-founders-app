import { AlertTriangle, CheckCircle2, Mail, Plus } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { StageBadge } from "../Investors/StageBadge";
import type { PipelineFocusEntry } from "../../../lib/pipeline-api";
import { cn, formatCompactUsd, getInitials } from "../../../lib/utils";
import { FOCUS_REASON_LABELS, FOCUS_REASON_TONES, formatDaysAgo } from "./deal-signals";

type FocusListProps = {
  items: PipelineFocusEntry[];
  canCreate: boolean;
  onOpen: (deal: PipelineFocusEntry) => void;
  onLog: (deal: PipelineFocusEntry) => void;
};

function dueLabel(nextTaskDueDate: string | null, now = Date.now()): string | null {
  if (!nextTaskDueDate) return null;
  const days = Math.round((new Date(nextTaskDueDate).getTime() - now) / (24 * 60 * 60 * 1000));
  if (days < 0) return `Overdue ${Math.abs(days)}d`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days}d`;
}

export function FocusList({ items, canCreate, onOpen, onLog }: FocusListProps) {
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
    <ul className="space-y-2">
      {items.map((deal) => {
        const investor = deal.investor;
        const due = dueLabel(deal.nextTaskDueDate);
        const urgent = deal.reason === "overdue";

        return (
          <li
            key={deal.id}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-xl border bg-surface/50 p-3",
              urgent ? "border-destructive/40" : "border-border/70",
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
                className="truncate text-left text-sm font-medium text-foreground hover:underline"
              >
                {investor.fullName}
              </button>
              <div className="truncate text-xs text-muted-foreground">
                {investor.ventureFirm ?? "Independent"}
                {deal.expectedAmount != null && ` · ${formatCompactUsd(deal.expectedAmount)}`}
              </div>
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
                <Button size="sm" onClick={() => onLog(deal)}>
                  <Plus className="h-4 w-4" />
                  Log
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
