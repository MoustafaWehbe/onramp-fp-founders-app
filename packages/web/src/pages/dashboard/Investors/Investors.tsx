import { useMemo, useState } from "react";
import { Plus, Upload, Users } from "lucide-react";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { investors as allInvestors, STAGES } from "../../../lib/mock-data";
// import { formatCompactUsd } from "../../../lib/utils";
import { InvestorsCardList } from "./InvestorsCardList";
import { InvestorsTable } from "./InvestorsTable";
import { InvestorsToolbar, type InvestorFilters } from "./InvestorsToolbar";

const emptyFilters: InvestorFilters = { stage: null, sector: null, firm: null };

const unique = (values: string[]) => Array.from(new Set(values)).sort();

export function Investors() {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<InvestorFilters>(emptyFilters);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filterOptions = useMemo(
    () => ({
      stages: STAGES.map((stage) => stage.label),
      sectors: unique(allInvestors.map((inv) => inv.sector)),
      firms: unique(allInvestors.map((inv) => inv.firm)),
    }),
    [],
  );

  const visibleInvestors = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return allInvestors.filter((inv) => {
      const matchesQuery =
        needle.length === 0 ||
        [inv.name, inv.firm, inv.email, inv.sector].some((field) =>
          field.toLowerCase().includes(needle),
        );

      const stageLabel = STAGES.find((stage) => stage.id === inv.pipelineStageId)?.label;

      return (
        matchesQuery &&
        (!filters.stage || stageLabel === filters.stage) &&
        (!filters.sector || inv.sector === filters.sector) &&
        (!filters.firm || inv.firm === filters.firm)
      );
    });
  }, [query, filters]);

  const summary = useMemo(() => {
    const committed = allInvestors.filter((inv) => inv.pipelineStageId === "committed");
    return {
      total: allInvestors.length,
      committedCount: committed.length,
      committedAmount: committed.reduce((sum, inv) => sum + inv.amount, 0),
      pipelineAmount: allInvestors.reduce((sum, inv) => sum + inv.amount, 0),
    };
  }, []);

  const handleFilterChange = (key: keyof InvestorFilters, value: string | null) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Only affects rows the current filters actually show.
  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const inv of visibleInvestors) {
        if (checked) next.add(inv.id);
        else next.delete(inv.id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investors"
        description="Your central directory of investors and firm relationships."
        actions={
          <>
            <Button variant="outline" size="sm">
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Add investor
            </Button>
          </>
        }
      />

      {/* Summary boxes - hidden for now, restore by uncommenting this block,
          the SummaryCard component below, and the formatCompactUsd import.
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Investors tracked"
          value={String(summary.total)}
          hint="Across all your startups"
        />
        <SummaryCard
          label="Committed"
          value={formatCompactUsd(summary.committedAmount)}
          hint={`${summary.committedCount} investors committed`}
        />
        <SummaryCard
          label="Pipeline value"
          value={formatCompactUsd(summary.pipelineAmount)}
          hint="Total of all tracked cheques"
        />
      </div>
      */}

      <InvestorsToolbar
        query={query}
        onQueryChange={setQuery}
        filters={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={() => setFilters(emptyFilters)}
        stageOptions={filterOptions.stages}
        sectorOptions={filterOptions.sectors}
        firmOptions={filterOptions.firms}
        selectedCount={selectedIds.size}
      />

      <div className="card-elevated overflow-hidden">
        {visibleInvestors.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface text-muted-foreground">
              <Users className="h-4 w-4" />
            </div>
            <p className="font-display text-base font-semibold">No investors match</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Try a different search term or clear your filters to see the full directory.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden lg:block">
              <InvestorsTable
                investors={visibleInvestors}
                selectedIds={selectedIds}
                onToggleOne={toggleOne}
                onToggleAll={toggleAllVisible}
              />
            </div>

            <div className="lg:hidden">
              <InvestorsCardList
                investors={visibleInvestors}
                selectedIds={selectedIds}
                onToggleOne={toggleOne}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
              <div className="tabular-nums">
                Showing {visibleInvestors.length} of {summary.total} investors
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" disabled>
                  Prev
                </Button>
                <Button size="sm" variant="ghost" disabled>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Used by the summary boxes above, kept for when they are restored.
// function SummaryCard({
//   label,
//   value,
//   hint,
// }: {
//   label: string;
//   value: string;
//   hint: string;
// }) {
//   return (
//     <div className="card-elevated p-5">
//       <div className="text-xs text-muted-foreground">{label}</div>
//       <div className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
//         {value}
//       </div>
//       <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
//     </div>
//   );
// }
