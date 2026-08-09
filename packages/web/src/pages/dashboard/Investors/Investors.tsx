import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Plus, Upload, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { usePermissions } from "../../../hooks/usePermissions";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { DEFAULT_PROBABILITY_BY_STAGE, STAGES } from "../../../lib/mock-data";
import { createPipelineEntry, listInvestorContacts } from "../../../lib/pipeline-api";
import { InvestorsCardList } from "./InvestorsCardList";
import { mapContactToRow, type InvestorRow } from "./investor-types";
import { InvestorsTable } from "./InvestorsTable";
import { InvestorsToolbar, type InvestorFilters } from "./InvestorsToolbar";

const emptyFilters: InvestorFilters = { stage: null, sector: null, firm: null };

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort();

function apiErrorMessage(err: unknown, fallback: string) {
  if (isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as { error?: string; message?: string; code?: string } | undefined;
    if (status === 403) {
      return "Forbidden — this account is not an active member of the current startup (or lacks pipeline permission).";
    }
    if (status === 401) {
      return "Not signed in — please log in again.";
    }
    return data?.error ?? data?.message ?? fallback;
  }
  return fallback;
}

export function Investors() {
  const startupId = useActiveStartupId();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const canCreate = can("pipeline", "create");
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<InvestorFilters>(emptyFilters);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const investorsQuery = useQuery({
    queryKey: ["investors", startupId],
    queryFn: () => listInvestorContacts(startupId, { page: 1, limit: 100 }),
  });

  const rows = useMemo(
    () => (investorsQuery.data?.data ?? []).map(mapContactToRow),
    [investorsQuery.data],
  );

  const filterOptions = useMemo(
    () => ({
      stages: STAGES.map((stage) => stage.label),
      sectors: unique(rows.map((inv) => inv.sector).filter((v) => v !== "—")),
      firms: unique(rows.map((inv) => inv.firm).filter((v) => v !== "—")),
    }),
    [rows],
  );

  const visibleInvestors = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return rows.filter((inv) => {
      const matchesQuery =
        needle.length === 0 ||
        [inv.name, inv.firm, inv.email, inv.sector].some((field) =>
          field.toLowerCase().includes(needle),
        );

      const stageLabel = inv.pipelineStageId
        ? STAGES.find((stage) => stage.id === inv.pipelineStageId)?.label
        : "Not in pipeline";

      return (
        matchesQuery &&
        (!filters.stage || stageLabel === filters.stage) &&
        (!filters.sector || inv.sector === filters.sector) &&
        (!filters.firm || inv.firm === filters.firm)
      );
    });
  }, [rows, query, filters]);

  const moveMutation = useMutation({
    mutationFn: (investor: InvestorRow) =>
      createPipelineEntry(startupId, {
        investorId: investor.id,
        stage: "sourced",
        expectedAmount: investor.amount ?? undefined,
        probabilityPercentage: DEFAULT_PROBABILITY_BY_STAGE.sourced,
      }),
    onSuccess: (_entry, investor) => {
      toast.success(`${investor.name} added to pipeline`);
      void queryClient.invalidateQueries({ queryKey: ["investors", startupId] });
      void queryClient.invalidateQueries({ queryKey: ["pipeline", startupId] });
      navigate("/pipeline");
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 409) {
        toast.message("Already in pipeline");
        navigate("/pipeline");
        return;
      }
      toast.error(apiErrorMessage(err, "Could not move to pipeline"));
    },
  });

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
          canCreate ? (
            <>
              <Button variant="outline" size="sm" disabled>
                <Upload className="h-4 w-4" />
                Import CSV
              </Button>
              <Button size="sm" disabled>
                <Plus className="h-4 w-4" />
                Add investor
              </Button>
            </>
          ) : null
        }
      />

      {investorsQuery.isError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
          {apiErrorMessage(investorsQuery.error, "Failed to load investors.")}
          <div className="mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: ["investors", startupId] })
              }
            >
              Retry
            </Button>
          </div>
        </div>
      )}

      <InvestorsToolbar
        query={query}
        onQueryChange={setQuery}
        filters={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={() => setFilters(emptyFilters)}
        stageOptions={[...filterOptions.stages, "Not in pipeline"]}
        sectorOptions={filterOptions.sectors}
        firmOptions={filterOptions.firms}
        selectedCount={selectedIds.size}
      />

      <div className="card-elevated overflow-hidden">
        {investorsQuery.isLoading ? (
          <div className="px-6 py-14 text-center text-sm text-muted-foreground">
            Loading investors…
          </div>
        ) : visibleInvestors.length === 0 && !investorsQuery.isError ? (
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
                onMoveToPipeline={(investor) => moveMutation.mutate(investor)}
                movingInvestorId={moveMutation.isPending ? moveMutation.variables?.id : null}
              />
            </div>

            <div className="lg:hidden">
              <InvestorsCardList
                investors={visibleInvestors}
                selectedIds={selectedIds}
                onToggleOne={toggleOne}
                onMoveToPipeline={(investor) => moveMutation.mutate(investor)}
                movingInvestorId={moveMutation.isPending ? moveMutation.variables?.id : null}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
              <div className="tabular-nums">
                Showing {visibleInvestors.length} of {rows.length} investors
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
