import { Check } from "lucide-react";
import { cn, formatCompactMoney, getInitials } from "../../../lib/utils";
import { InvestorActions } from "./InvestorActions";
import type { InvestorRow } from "./investor-types";
import { StageBadge } from "./StageBadge";

type InvestorsTableProps = {
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

export function InvestorsTable({
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
}: InvestorsTableProps) {
  const selectionActive = selectedIds !== null;

  return (
    <div className="scrollbar-slim overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface/60 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Investor</th>
            <th scope="col" className="px-4 py-3 font-medium">Firm</th>
            <th scope="col" className="px-4 py-3 font-medium">Sector focus</th>
            <th scope="col" className="px-4 py-3 font-medium">Stage pref</th>
            <th scope="col" className="px-4 py-3 font-medium">Pipeline</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
            <th scope="col" className="px-4 py-3 font-medium">Last contact</th>
            <th scope="col" className="w-12 px-4 py-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {investors.map((investor) => {
            const selected = selectedIds?.has(investor.id) ?? false;
            return (
              <tr
                key={investor.id}
                aria-selected={selectionActive ? selected : undefined}
                onClick={selectionActive ? () => onToggleOne(investor.id) : undefined}
                className={cn(
                  "transition-colors",
                  selectionActive ? "cursor-pointer hover:bg-surface-hover/50" : "hover:bg-surface-hover/50",
                  selected && "bg-primary/6",
                )}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {/* Same slot whether selection mode is on or not, so entering it
                        never reflows the table. In selection mode the avatar itself
                        becomes the selected indicator a filled circle with a check
                        rather than a separate checkbox; the whole row is already
                        the hit area. */}
                    <div
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-full font-display text-xs font-semibold transition-colors",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-primary/15 text-primary",
                      )}
                    >
                      {selected ? <Check className="h-4 w-4" /> : getInitials(investor.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{investor.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {investor.email || "No email"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-foreground">{investor.firm}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {investor.sector}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {investor.stagePreference}
                </td>
                <td className="px-4 py-3">
                  <StageBadge stageId={investor.pipelineStageId} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-foreground">
                  {investor.amount != null
                    ? formatCompactMoney(
                        investor.amount,
                        (investor.roundId && currencyByRoundId.get(investor.roundId)) || "USD",
                      )
                    : "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {investor.lastContact}
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
