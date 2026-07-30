import { Checkbox } from "../../../components/ui/checkbox";
import type { Investor } from "../../../lib/mock-data";
import { cn, formatCompactUsd, getInitials } from "../../../lib/utils";
import { InvestorActions } from "./InvestorActions";
import { StageBadge } from "./StageBadge";

type InvestorsCardListProps = {
  investors: Investor[];
  selectedIds: Set<string>;
  onToggleOne: (id: string) => void;
};

export function InvestorsCardList({
  investors,
  selectedIds,
  onToggleOne,
}: InvestorsCardListProps) {
  return (
    <ul className="divide-y divide-border/60">
      {investors.map((investor) => {
        const selected = selectedIds.has(investor.id);
        return (
          <li
            key={investor.id}
            className={cn("flex items-start gap-3 p-4", selected && "bg-primary/[0.04]")}
          >
            <Checkbox
              checked={selected}
              onChange={() => onToggleOne(investor.id)}
              aria-label={`Select ${investor.name}`}
              className="mt-3"
            />

            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-xs font-semibold text-primary">
              {getInitials(investor.name)}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {investor.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{investor.firm}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-medium tabular-nums text-foreground">
                    {formatCompactUsd(investor.amount)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{investor.lastContact}</div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StageBadge stageId={investor.pipelineStageId} />
                <span className="text-xs text-muted-foreground">{investor.sector}</span>
                <span className="text-xs text-muted-foreground">· {investor.stagePreference}</span>
              </div>
            </div>

            <InvestorActions investor={investor} />
          </li>
        );
      })}
    </ul>
  );
}
