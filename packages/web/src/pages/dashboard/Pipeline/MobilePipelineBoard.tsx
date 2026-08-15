import { useState } from "react";
import { Card } from "../../../components/ui/card";
import type { PipelineStage, PipelineStageId } from "../../../lib/mock-data";
import type { FocusReason, PipelineEntry } from "../../../lib/pipeline-api";
import { cn, formatCompactMoney } from "../../../lib/utils";
import type { DealSignals } from "./deal-signals";
import { DealCardBody } from "./DealCard";

type MobilePipelineBoardProps = {
  stages: PipelineStage[];
  /** The round's own currency a deal's amount is never assumed to be USD. */
  currency: string;
  entriesByStage: Map<PipelineStageId, PipelineEntry[]>;
  signalsFor: (dealId: string) => DealSignals;
  focusReasonFor: (dealId: string) => FocusReason | null;
  ownerNameFor: (dealId: string) => string | null;
  canUpdate: boolean;
  emptyMessage: string;
  onOpen: (dealId: string) => void;
  onMove: (dealId: string, stage: PipelineStageId) => void;
  onAddTask?: (dealId: string) => void;
};

/**
 * The board's small-screen equivalent: one stage on screen at a time instead
 * of seven columns squeezed into a swipeable strip. Touch drag-reordering
 * between narrow columns is fiddly and error-prone on a phone, so this reuses
 * each card's own "Move to stage" menu already keyboard- and
 * screen-reader-accessible as the only way to change stage here, and drops
 * pointer/keyboard drag entirely rather than forcing the desktop board's
 * interaction model onto a touchscreen.
 */
export function MobilePipelineBoard({
  stages,
  currency,
  entriesByStage,
  signalsFor,
  focusReasonFor,
  ownerNameFor,
  canUpdate,
  emptyMessage,
  onOpen,
  onMove,
  onAddTask,
}: MobilePipelineBoardProps) {
  const [activeStage, setActiveStage] = useState<PipelineStageId>(stages[0]?.id ?? "sourced");
  const stage = stages.find((candidate) => candidate.id === activeStage) ?? stages[0] ?? null;
  const deals = stage ? (entriesByStage.get(stage.id) ?? []) : [];
  const weightedTotal = deals.reduce(
    (sum, deal) => sum + (deal.expectedAmount ?? 0) * ((deal.probabilityPercentage ?? 0) / 100),
    0,
  );

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Pipeline stage"
        className="scrollbar-none -mx-4 flex touch-pan-x snap-x snap-mandatory gap-1.5 overflow-x-auto px-4 pb-1"
      >
        {stages.map((candidate) => {
          const count = entriesByStage.get(candidate.id)?.length ?? 0;
          const selected = candidate.id === activeStage;
          return (
            <button
              key={candidate.id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => setActiveStage(candidate.id)}
              className={cn(
                "flex shrink-0 snap-start items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors",
                selected
                  ? "border-primary bg-primary/10 font-medium text-foreground"
                  : "border-border/70 bg-surface/50 text-muted-foreground",
              )}
            >
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", candidate.dotClass)} />
              {candidate.label}
              <span className="font-mono text-[11px] tabular-nums opacity-75">{count}</span>
            </button>
          );
        })}
      </div>

      {stage && (
        <ul className="space-y-2" aria-label={`${stage.label} deals`}>
          {deals.map((deal) => (
            <li key={deal.id}>
              <Card className="relative min-h-[128px] border-border/70 bg-card/95 p-3 shadow-sm">
                <DealCardBody
                  deal={deal}
                  currency={currency}
                  signals={signalsFor(deal.id)}
                  focusReason={focusReasonFor(deal.id)}
                  ownerName={ownerNameFor(deal.id)}
                  canUpdate={canUpdate}
                  onOpen={onOpen}
                  onMove={onMove}
                  onAddTask={onAddTask}
                />
              </Card>
            </li>
          ))}

          {deals.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              {emptyMessage}
            </div>
          )}
        </ul>
      )}

      {stage && weightedTotal > 0 && (
        <div className="text-right font-mono text-xs text-muted-foreground">
          {formatCompactMoney(Math.round(weightedTotal), currency)} weighted
        </div>
      )}
    </div>
  );
}
