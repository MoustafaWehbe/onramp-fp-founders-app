import { AlertTriangle, Check, CheckCircle2, Mail, Plus } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { StageBadge } from "../Investors/StageBadge";
import type { PipelineEntry } from "../../../lib/pipeline-api";
import { cn, formatCompactUsd, getInitials } from "../../../lib/utils";
import {
  attentionReason,
  followupLabel,
  formatDaysAgo,
  formatDuration,
  type DealSignals,
} from "./deal-signals";

export type FocusItem = {
  deal: PipelineEntry;
  signals: DealSignals;
};

type FocusListProps = {
  items: FocusItem[];
  canUpdate: boolean;
  canCreate: boolean;
  /** Id of the log whose "mark done" is in flight, so only that row spins. */
  completingLogId: string | null;
  onOpen: (deal: PipelineEntry) => void;
  onLog: (deal: PipelineEntry) => void;
  onMarkDone: (logId: string) => void;
};

export function FocusList({
  items,
  canUpdate,
  canCreate,
  completingLogId,
  onOpen,
  onLog,
  onMarkDone,
}: FocusListProps) {
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
      {items.map(({ deal, signals }) => {
        const investor = deal.investor;
        const reason = attentionReason(signals);
        const due = followupLabel(signals);
        const urgent = signals.followup === "overdue";

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
                {` · in stage ${formatDuration(signals.daysInStage)}`}
              </div>
            </div>

            <div className="flex min-w-0 flex-col items-start gap-1 sm:items-end">
              <StageBadge stageId={deal.stage} />
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px]",
                  urgent ? "text-destructive" : "text-muted-foreground",
                )}
              >
                <AlertTriangle className="h-3 w-3" />
                {due ?? reason}
                {due && signals.lastTouch && ` · last ${formatDaysAgo(signals.daysQuiet)}`}
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
              {/* Marking done only applies to an open follow-up; a quiet deal has
                  no follow-up to close, so logging is the only way forward. */}
              {canUpdate && signals.followupLogId && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={completingLogId === signals.followupLogId}
                  onClick={() => onMarkDone(signals.followupLogId!)}
                  aria-label={`Mark follow-up with ${investor.fullName} done`}
                >
                  <Check className="h-4 w-4" />
                  {completingLogId === signals.followupLogId ? "Saving…" : "Done"}
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
