import { Checkbox } from "../../../components/ui/checkbox";
import { cn, formatCompactUsd, getInitials } from "../../../lib/utils";
import { InvestorActions } from "./InvestorActions";
import type { InvestorRow } from "./investor-types";
import { StageBadge } from "./StageBadge";

type InvestorsTableProps = {
  investors: InvestorRow[];
  selectedIds: Set<string>;
  onToggleOne: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onMoveToPipeline: (investor: InvestorRow) => void;
  onEdit: (investor: InvestorRow) => void;
  onDelete: (investor: InvestorRow) => void;
  movingInvestorId?: string | null;
};

export function InvestorsTable({
  investors,
  selectedIds,
  onToggleOne,
  onToggleAll,
  onMoveToPipeline,
  onEdit,
  onDelete,
  movingInvestorId = null,
}: InvestorsTableProps) {
  const allSelected = investors.length > 0 && investors.every((inv) => selectedIds.has(inv.id));
  const someSelected = investors.some((inv) => selectedIds.has(inv.id));

  return (
    <div className="scrollbar-slim overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface/60 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th scope="col" className="w-10 px-4 py-3">
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && someSelected}
                onChange={(e) => onToggleAll(e.target.checked)}
                aria-label="Select all investors"
              />
            </th>
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
            const selected = selectedIds.has(investor.id);
            return (
              <tr
                key={investor.id}
                className={cn(
                  "transition-colors hover:bg-surface-hover/50",
                  selected && "bg-primary/[0.04]",
                )}
              >
                <td className="px-4 py-3">
                  <Checkbox
                    checked={selected}
                    onChange={() => onToggleOne(investor.id)}
                    aria-label={`Select ${investor.name}`}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-xs font-semibold text-primary">
                      {getInitials(investor.name)}
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
                  {investor.amount != null ? formatCompactUsd(investor.amount) : "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {investor.lastContact}
                </td>
                <td className="px-4 py-3">
                  <InvestorActions
                    investor={investor}
                    onMoveToPipeline={onMoveToPipeline}
                    onEdit={onEdit}
                    onDelete={onDelete}
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
