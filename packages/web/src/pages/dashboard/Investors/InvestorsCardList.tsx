import { Check } from "lucide-react";
import { cn, formatCompactMoney, getInitials } from "../../../lib/utils";
import { InvestorActions } from "./InvestorActions";
import type { InvestorRow } from "./investor-types";
import { StageBadge } from "./StageBadge";

type InvestorsCardListProps = {
  investors: InvestorRow[];
  /** roundId -> currency, so each contact's amount shows in its own round's currency. */
  currencyByRoundId: Map<string, string>;
  /** null hides selection entirely same convention as the Pipeline board. */
  selectedIds: Set<string> | null;
  onToggleOne: (id: string) => void;
  onMoveToPipeline: (investor: InvestorRow) => void;
  onEdit: (investor: InvestorRow) => void;
  onDelete: (investor: InvestorRow) => void;
  onViewHistory: (investor: InvestorRow) => void;
  onEmail: (investor: InvestorRow) => void;
  googleConnected: boolean;
  movingInvestorId?: string | null;
};

export function InvestorsCardList({
  investors,
  currencyByRoundId,
  selectedIds,
  onToggleOne,
  onMoveToPipeline,
  onEdit,
  onDelete,
  onViewHistory,
  onEmail,
  googleConnected,
  movingInvestorId = null,
}: InvestorsCardListProps) {
  const selectionActive = selectedIds !== null;

  return (
    <ul className="divide-y divide-border/60">
      {investors.map((investor) => {
        const selected = selectedIds?.has(investor.id) ?? false;
        return (
          <li
            key={investor.id}
            aria-selected={selectionActive ? selected : undefined}
            onClick={selectionActive ? () => onToggleOne(investor.id) : undefined}
            className={cn(
              "flex items-start gap-3 p-4",
              selectionActive && "cursor-pointer",
              selected && "bg-primary/[0.06]",
            )}
          >
            {/* Avatar doubles as the selection indicator in selection mode a
                filled circle with a check rather than a separate checkbox. */}
            <div
              className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-xs font-semibold transition-colors",
                selected ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary",
              )}
            >
              {selected ? <Check className="h-4 w-4" /> : getInitials(investor.name)}
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
                    {investor.amount != null
                      ? formatCompactMoney(
                          investor.amount,
                          (investor.roundId && currencyByRoundId.get(investor.roundId)) || "USD",
                        )
                      : "—"}
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

            <div onClick={(e) => e.stopPropagation()}>
              <InvestorActions
                investor={investor}
                onMoveToPipeline={onMoveToPipeline}
                onEdit={onEdit}
                onDelete={onDelete}
                onViewHistory={onViewHistory}
                onEmail={onEmail}
                googleConnected={googleConnected}
                moving={movingInvestorId === investor.id}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
