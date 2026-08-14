import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { PipelineStage, PipelineStageId } from "../../../lib/mock-data";
import type { FocusReason, PipelineEntry } from "../../../lib/pipeline-api";
import { cn, formatCompactMoney } from "../../../lib/utils";
import { columnDropId } from "./board-columns";
import type { DealSignals } from "./deal-signals";
import { DealCard } from "./DealCard";

type PipelineColumnProps = {
  stage: PipelineStage;
  /** The round's own currency — a deal's amount is never assumed to be USD. */
  currency: string;
  dealIds: string[];
  entriesById: Map<string, PipelineEntry>;
  signalsFor: (dealId: string) => DealSignals;
  focusReasonFor: (dealId: string) => FocusReason | null;
  ownerNameFor: (dealId: string) => string | null;
  canUpdate: boolean;
  weightedTotal: number;
  emptyMessage: string;
  /** Null when the board is not in selection mode. */
  selectedIds: ReadonlySet<string> | null;
  onOpen: (dealId: string) => void;
  onMove: (dealId: string, stage: PipelineStageId) => void;
  onAddTask?: (dealId: string) => void;
  onToggleSelected?: (dealId: string) => void;
};

/**
 * Memoized for the same reason DealCard is: a drag re-derives `columns` on
 * every pointer move, but only the from/to columns actually get a new
 * dealIds array — every other column's props stay referentially identical
 * and can skip re-rendering entirely.
 */
export const PipelineColumn = memo(function PipelineColumn({
  stage,
  currency,
  dealIds,
  entriesById,
  signalsFor,
  focusReasonFor,
  ownerNameFor,
  canUpdate,
  weightedTotal,
  emptyMessage,
  selectedIds,
  onOpen,
  onMove,
  onAddTask,
  onToggleSelected,
}: PipelineColumnProps) {
  // A fallback drop target for a column's empty space — cards themselves are
  // the finer-grained targets while the column has any.
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(stage.id) });

  return (
    <section
      className="w-[min(18rem,85vw)] flex-none snap-start sm:w-72"
      aria-labelledby={`pipeline-stage-${stage.id}`}
    >
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", stage.dotClass)} />
          <h2
            id={`pipeline-stage-${stage.id}`}
            className="truncate font-display text-sm font-semibold text-foreground"
          >
            {stage.label}
          </h2>
          <span className="font-mono text-xs text-muted-foreground">{dealIds.length}</span>
        </div>
        {weightedTotal > 0 && (
          <span
            className="shrink-0 font-mono text-xs text-muted-foreground"
            title="Probability-weighted forecast"
          >
            {formatCompactMoney(Math.round(weightedTotal), currency)}
          </span>
        )}
      </div>

      {/* Fixed height — about three cards — so no column ever grows past its
          neighbours; anything beyond that scrolls inside. */}
      <div
        ref={setNodeRef}
        className={cn(
          "scrollbar-none h-[26rem] space-y-2 overflow-y-auto rounded-xl border border-border/70 bg-surface/50 p-2 transition-colors",
          isOver && "border-primary/50 bg-primary/[0.04]",
        )}
      >
        <SortableContext items={dealIds} strategy={verticalListSortingStrategy}>
          {dealIds.map((dealId) => {
            const deal = entriesById.get(dealId);
            if (!deal) return null;
            return (
              <DealCard
                key={dealId}
                deal={deal}
                currency={currency}
                signals={signalsFor(dealId)}
                focusReason={focusReasonFor(dealId)}
                ownerName={ownerNameFor(dealId)}
                canUpdate={canUpdate}
                selected={selectedIds === null ? null : selectedIds.has(dealId)}
                onOpen={onOpen}
                onMove={onMove}
                onAddTask={onAddTask}
                onToggleSelected={onToggleSelected}
              />
            );
          })}
        </SortableContext>

        {dealIds.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            {emptyMessage}
          </div>
        )}
      </div>
    </section>
  );
});
