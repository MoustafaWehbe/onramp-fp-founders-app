import { useMemo, useState, type DragEvent } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import {
  investors,
  pipelineDeals as initialPipelineDeals,
  STAGES,
  type PipelineDeal,
  type PipelineStageId,
} from "../../../lib/mock-data";
import { cn, formatCompactUsd, getInitials } from "../../../lib/utils";

const investorsById = new Map(investors.map((investor) => [investor.id, investor]));

const probabilityByStage: Record<PipelineStageId, number> = {
  lead: 10,
  contacted: 25,
  meeting: 45,
  diligence: 70,
  committed: 90,
  closed: 100,
  passed: 0,
};

export function Pipeline() {
  const [deals, setDeals] = useState<PipelineDeal[]>(initialPipelineDeals);
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<PipelineStageId | null>(null);

  const dealsByStage = useMemo(() => {
    const grouped = new Map<PipelineStageId, PipelineDeal[]>(
      STAGES.map((stage) => [stage.id, []]),
    );

    for (const deal of deals) grouped.get(deal.stageId)?.push(deal);
    return grouped;
  }, [deals]);

  const handleDragStart = (event: DragEvent<HTMLElement>, dealId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dealId);
    setDraggedDealId(dealId);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, stageId: PipelineStageId) => {
    event.preventDefault();
    const dealId = event.dataTransfer.getData("text/plain") || draggedDealId;
    if (!dealId) return;

    setDeals((current) =>
      current.map((deal) =>
        deal.id === dealId
          ? {
              ...deal,
              stageId,
              probabilityPercentage: probabilityByStage[stageId],
            }
          : deal,
      ),
    );
    setDraggedDealId(null);
    setDropTarget(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deal pipeline"
        description="Drag investors through stages and forecast your round by probability."
        actions={
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Add to pipeline
          </Button>
        }
      />

      <div className="scrollbar-slim flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          const weightedTotal = stageDeals.reduce(
            (sum, deal) => sum + deal.expectedAmount * (deal.probabilityPercentage / 100),
            0,
          );

          return (
            <section
              key={stage.id}
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
                  <span className="font-mono text-xs text-muted-foreground">
                    {stageDeals.length}
                  </span>
                </div>
                {weightedTotal > 0 && (
                  <span
                    className="shrink-0 font-mono text-xs text-muted-foreground"
                    title="Probability-weighted forecast"
                  >
                    {formatCompactUsd(weightedTotal)}
                  </span>
                )}
              </div>

              <div
                className={cn(
                  "min-h-[24rem] space-y-2 rounded-xl border border-border/70 bg-surface/50 p-2 transition-colors",
                  dropTarget === stage.id && "border-primary/50 bg-primary/[0.04]",
                )}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDropTarget(stage.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setDropTarget(null);
                  }
                }}
                onDrop={(event) => handleDrop(event, stage.id)}
              >
                {stageDeals.map((deal) => {
                  const investor = investorsById.get(deal.investorId);
                  if (!investor) return null;

                  return (
                    <Card
                      key={deal.id}
                      draggable
                      onDragStart={(event) => handleDragStart(event, deal.id)}
                      onDragEnd={() => {
                        setDraggedDealId(null);
                        setDropTarget(null);
                      }}
                      className={cn(
                        "cursor-grab border-border/70 bg-card/95 p-3 shadow-sm transition-[border-color,opacity,transform] hover:-translate-y-0.5 hover:border-primary/40 active:cursor-grabbing",
                        draggedDealId === deal.id && "opacity-50",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-[10px] font-semibold text-primary">
                          {getInitials(investor.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">
                            {investor.name}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {investor.firm}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">
                          {formatCompactUsd(deal.expectedAmount)}
                        </span>
                        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {deal.probabilityPercentage}%
                        </span>
                      </div>
                      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width] duration-300",
                            stage.id === "passed" ? "bg-destructive" : "bg-primary",
                          )}
                          style={{ width: `${deal.probabilityPercentage}%` }}
                        />
                      </div>
                    </Card>
                  );
                })}

                {stageDeals.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    Drop an investor here
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
