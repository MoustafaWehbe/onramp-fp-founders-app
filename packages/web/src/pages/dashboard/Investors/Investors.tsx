import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { usePermissions } from "../../../hooks/usePermissions";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-error";
import { DEFAULT_PROBABILITY_BY_STAGE } from "../../../lib/mock-data";
import {
  createInvestor,
  deleteInvestor,
  listInvestors,
  updateInvestor,
  type Engagement,
  type InvestorInput,
} from "../../../lib/investor-api";
import { createPipelineEntry } from "../../../lib/pipeline-api";
import { cn } from "../../../lib/utils";
import { InvestorDetailDialog } from "./InvestorDetailDialog";
import { InvestorFormDialog } from "./InvestorFormDialog";
import { InvestorsCardList } from "./InvestorsCardList";
import { mapContactToRow, type InvestorRow } from "./investor-types";
import { InvestorsTable } from "./InvestorsTable";
import { InvestorsToolbar, type InvestorFilters } from "./InvestorsToolbar";

const PAGE_SIZE = 25;
const emptyFilters: InvestorFilters = { stage: null, investorType: null };

const TABS: { id: Engagement; label: string; blurb: string }[] = [
  {
    id: "engaged",
    label: "My investors",
    blurb: "Contacts you've approached — on the pipeline board, or with a logged interaction.",
  },
  {
    id: "prospect",
    label: "Prospects",
    blurb: "Sourced but not yet contacted. Nothing has been logged against these.",
  },
];

const FORBIDDEN_HINT =
  "You don't have permission to change investors in this workspace.";

function mutationErrorMessage(err: unknown, fallback: string): string {
  switch (apiErrorCode(err)) {
    case "DUPLICATE_EMAIL":
      return "Another contact in this workspace already uses that email.";
    case "HAS_DEPENDENTS":
      return "This contact has pipeline entries, commitments or logged interactions, so it can't be deleted.";
    case "INVESTOR_NOT_FOUND":
      return "That contact no longer exists — it may have been removed by a teammate.";
    default:
      return apiErrorMessage(err, fallback, FORBIDDEN_HINT);
  }
}

export function Investors() {
  const startupId = useActiveStartupId();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const canCreate = can("pipeline", "create");

  const [tab, setTab] = useState<Engagement>("engaged");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<InvestorFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvestorRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<InvestorRow | null>(null);
  const [viewing, setViewing] = useState<InvestorRow | null>(null);

  // Typing shouldn't fire a request per keystroke now that search runs server-side.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Any change to what's being asked for restarts at page 1, otherwise a
  // narrower result set can leave you stranded on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [tab, debouncedSearch, filters.stage, filters.investorType]);

  const investorsQuery = useQuery({
    queryKey: [
      "investors",
      startupId,
      { tab, search: debouncedSearch, ...filters, page },
    ],
    queryFn: () =>
      listInvestors(startupId, {
        page,
        limit: PAGE_SIZE,
        engagement: tab,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(filters.investorType ? { investorType: filters.investorType } : {}),
        // Stage only exists for contacts on the board, so it never applies to
        // the prospects tab.
        ...(tab === "engaged" && filters.stage ? { stage: filters.stage } : {}),
      }),
    placeholderData: (previous) => previous,
  });

  const rows = useMemo(
    () => (investorsQuery.data?.data ?? []).map(mapContactToRow),
    [investorsQuery.data],
  );

  const meta = investorsQuery.data?.meta;
  const counts = meta?.engagementCounts ?? { engaged: 0, prospect: 0 };
  const totalPages = meta?.totalPages ?? 1;

  const invalidateInvestors = () => {
    void queryClient.invalidateQueries({ queryKey: ["investors", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["pipeline", startupId] });
  };

  const saveMutation = useMutation({
    mutationFn: (input: InvestorInput) =>
      editing
        ? updateInvestor(startupId, editing.id, input)
        : createInvestor(startupId, input),
    onSuccess: (contact) => {
      toast.success(editing ? `${contact.fullName} updated` : `${contact.fullName} added`);
      setFormOpen(false);
      setEditing(null);
      invalidateInvestors();
    },
    onError: (err) => toast.error(mutationErrorMessage(err, "Could not save the investor")),
  });

  const deleteMutation = useMutation({
    mutationFn: (investor: InvestorRow) => deleteInvestor(startupId, investor.id),
    onSuccess: (_result, investor) => {
      toast.success(`${investor.name} deleted`);
      setPendingDelete(null);
      invalidateInvestors();
    },
    onError: (err) => toast.error(mutationErrorMessage(err, "Could not delete the investor")),
  });

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
      invalidateInvestors();
      navigate("/pipeline");
    },
    onError: (err) => {
      if (apiErrorCode(err) === "ALREADY_IN_PIPELINE") {
        toast.message("Already in pipeline");
        navigate("/pipeline");
        return;
      }
      toast.error(mutationErrorMessage(err, "Could not move to pipeline"));
    },
  });

  const handleFilterChange = <K extends keyof InvestorFilters>(
    key: K,
    value: InvestorFilters[K],
  ) => setFilters((prev) => ({ ...prev, [key]: value }));

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = (checked: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const inv of rows) {
        if (checked) next.add(inv.id);
        else next.delete(inv.id);
      }
      return next;
    });

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (investor: InvestorRow) => {
    setEditing(investor);
    setFormOpen(true);
  };

  const activeTab = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investors"
        description="Your directory of investor relationships, split by whether you've reached out."
        actions={
          canCreate ? (
            <>
              <Button variant="outline" size="sm" disabled>
                <Upload className="h-4 w-4" />
                Import CSV
              </Button>
              <Button size="sm" onClick={openAdd}>
                <Plus className="h-4 w-4" />
                Add investor
              </Button>
            </>
          ) : null
        }
      />

      <div>
        <div
          role="tablist"
          aria-label="Investor engagement"
          className="inline-flex items-center gap-1 rounded-xl border border-border/70 bg-surface/60 p-1"
        >
          {TABS.map((item) => {
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
                    active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {counts[item.id]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{activeTab.blurb}</p>
      </div>

      {investorsQuery.isError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
          {apiErrorMessage(investorsQuery.error, "Failed to load investors.")}
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => void investorsQuery.refetch()}>
              Retry
            </Button>
          </div>
        </div>
      )}

      <InvestorsToolbar
        query={search}
        onQueryChange={setSearch}
        filters={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={() => setFilters(emptyFilters)}
        showStageFilter={tab === "engaged"}
        selectedCount={selectedIds.size}
      />

      <div className="card-elevated overflow-hidden">
        {investorsQuery.isPending ? (
          <div className="px-6 py-14 text-center text-sm text-muted-foreground">
            Loading investors…
          </div>
        ) : rows.length === 0 && !investorsQuery.isError ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface text-muted-foreground">
              <Users className="h-4 w-4" />
            </div>
            <p className="font-display text-base font-semibold">
              {debouncedSearch || filters.stage || filters.investorType
                ? "No investors match"
                : tab === "engaged"
                  ? "You haven't reached out to anyone yet"
                  : "No prospects yet"}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {debouncedSearch || filters.stage || filters.investorType
                ? "Try a different search term or clear your filters."
                : tab === "engaged"
                  ? "Move a prospect into the pipeline, or log an interaction, and they'll appear here."
                  : "Add investors to build up a list to work through."}
            </p>
            {canCreate && !debouncedSearch && tab === "prospect" && (
              <Button size="sm" className="mt-2" onClick={openAdd}>
                <Plus className="h-4 w-4" />
                Add investor
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className={cn("hidden lg:block", investorsQuery.isFetching && "opacity-60")}>
              <InvestorsTable
                investors={rows}
                selectedIds={selectedIds}
                onToggleOne={toggleOne}
                onToggleAll={toggleAllVisible}
                onMoveToPipeline={(investor) => moveMutation.mutate(investor)}
                onEdit={openEdit}
                onDelete={setPendingDelete}
                onViewHistory={setViewing}
                movingInvestorId={moveMutation.isPending ? moveMutation.variables?.id : null}
              />
            </div>

            <div className={cn("lg:hidden", investorsQuery.isFetching && "opacity-60")}>
              <InvestorsCardList
                investors={rows}
                selectedIds={selectedIds}
                onToggleOne={toggleOne}
                onMoveToPipeline={(investor) => moveMutation.mutate(investor)}
                onEdit={openEdit}
                onDelete={setPendingDelete}
                onViewHistory={setViewing}
                movingInvestorId={moveMutation.isPending ? moveMutation.variables?.id : null}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
              <div className="tabular-nums">
                {meta ? `${rows.length} of ${meta.total}` : rows.length} investors
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1 || investorsQuery.isFetching}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="tabular-nums">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages || investorsQuery.isFetching}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <InvestorDetailDialog
        startupId={startupId}
        investor={viewing}
        onOpenChange={(open) => !open && setViewing(null)}
        onEditInvestor={(investor) => {
          // Editing takes over the screen; the history dialog would sit behind it.
          setViewing(null);
          openEdit(investor);
        }}
      />

      <InvestorFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        investor={editing?.contact ?? null}
        isSubmitting={saveMutation.isPending}
        onSubmit={(input) => saveMutation.mutate(input)}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.name}?</DialogTitle>
            <DialogDescription>
              This removes the contact from your directory. If they're on the pipeline board or
              have logged interactions, the delete will be refused — remove those first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete investor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
