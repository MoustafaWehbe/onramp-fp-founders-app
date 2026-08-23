import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, Users } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { EmptyState } from "../../../components/shared/EmptyState";
import { ConfirmDialog } from "../../../components/shared/ConfirmDialog";
import { GoogleNotConnectedNotice } from "../../../components/shared/GoogleNotConnectedNotice";
import { usePermissions } from "../../../hooks/usePermissions";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { useGoogleConnectionStatus } from "../../../hooks/useGoogleConnection";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-error";
import { runWithConcurrency } from "../../../lib/concurrency";
import { sendInvestorEmail } from "../../../lib/gmail-api";
import { DEFAULT_PROBABILITY_BY_STAGE } from "../../../lib/mock-data";
import {
  createInvestor,
  deleteInvestor,
  getInvestor,
  listInvestors,
  updateInvestor,
  type Engagement,
  type InvestorInput,
} from "../../../lib/investor-api";
import { listFundraisingRounds } from "../../../lib/fundraising-api";
import { STAGES, type PipelineStageId } from "../../../lib/mock-data";
import { createPipelineEntry } from "../../../lib/pipeline-api";
import { invalidateDealData, invalidateInteractionData, qk } from "../../../lib/query-keys";
import { useAppStore } from "../../../lib/app-store";
import { cn } from "../../../lib/utils";
import { ComposeEmailDialog, type ComposeFormValues } from "./ComposeEmailDialog";
import { ImportInvestorsDialog } from "./ImportInvestorsDialog";
import { InvestorDetailDialog } from "./InvestorDetailDialog";
import { InvestorFormDialog } from "./InvestorFormDialog";
import { InvestorsCardList } from "./InvestorsCardList";
import { mapContactToRow, type InvestorRow } from "./investor-types";
import { InvestorsTable } from "./InvestorsTable";
import { InvestorsToolbar, type InvestorFilters } from "./InvestorsToolbar";

const PAGE_SIZE = 10;
const emptyFilters: InvestorFilters = { stage: null, investorType: null };

const VALID_STAGE_IDS = new Set<string>(STAGES.map((stage) => stage.id));

/**
 * A chart segment elsewhere in the app (a pipeline stage on the Dashboard
 * pie, a funnel bar) links here as `?tab=engaged&stage=X` to open already
 * filtered to what was clicked read once on mount, same as Pipeline.tsx
 * does for its own `?view=` param.
 */
function initialStateFromUrl(): { tab: Engagement; stage: PipelineStageId | null } {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab") === "prospect" ? "prospect" : "engaged";
  const requestedStage = params.get("stage");
  const stage =
    requestedStage && VALID_STAGE_IDS.has(requestedStage) ? (requestedStage as PipelineStageId) : null;
  return { tab, stage };
}

const TABS: { id: Engagement; label: string; blurb: string }[] = [
  {
    id: "engaged",
    label: "My investors",
    blurb: "Contacts you've approached on the pipeline board, or with a logged interaction.",
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
      return "That contact no longer exists it may have been removed by a teammate.";
    case "ALREADY_IN_PIPELINE":
      return "Already in the pipeline.";
    default:
      return apiErrorMessage(err, fallback, FORBIDDEN_HINT);
  }
}

function sendEmailErrorMessage(err: unknown): string {
  switch (apiErrorCode(err)) {
    case "INVESTOR_EMAIL_MISSING":
      return "This investor has no email on file.";
    case "GOOGLE_NOT_CONNECTED":
      return "Connect your Google account in Settings to send email.";
    case "GOOGLE_NEEDS_REAUTH":
      return "Your Google connection needs to be reconnected see Settings.";
    case "GMAIL_SEND_FAILED":
      return "Google rejected the send. Please try again.";
    default:
      return apiErrorMessage(err, "Could not send the email", FORBIDDEN_HINT);
  }
}

export function Investors() {
  const startupId = useActiveStartupId();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const googleStatus = useGoogleConnectionStatus();
  const preferredRoundId = useAppStore((state) => state.activeRoundIds[startupId]);

  const canCreate = can("pipeline", "create");
  const canDelete = can("pipeline", "delete");
  const canSelect = canCreate || canDelete;

  const [tab, setTab] = useState<Engagement>(() => initialStateFromUrl().tab);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<InvestorFilters>(() => ({
    ...emptyFilters,
    stage: initialStateFromUrl().stage,
  }));
  const [page, setPage] = useState(1);
  // null means selection mode is off entirely; an empty set means it's on,
  // with nothing picked yet same convention as the Pipeline board.
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvestorRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<InvestorRow | null>(null);
  const [viewing, setViewing] = useState<InvestorRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [quickEmailInvestor, setQuickEmailInvestor] = useState<InvestorRow | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkInvestorId = searchParams.get("investor");
  const deepLinkInvestorQuery = useQuery({
    queryKey: qk.investors(startupId, { deepLink: deepLinkInvestorId }),
    queryFn: () => getInvestor(startupId, deepLinkInvestorId!),
    enabled: deepLinkInvestorId !== null,
  });
  useEffect(() => {
    if (!deepLinkInvestorId || !deepLinkInvestorQuery.data) return;
    setViewing(mapContactToRow(deepLinkInvestorQuery.data));
    setSearchParams(
      (prev) => {
        if (!prev.has("investor")) return prev;
        const next = new URLSearchParams(prev);
        next.delete("investor");
        return next;
      },
      { replace: true },
    );
  }, [deepLinkInvestorId, deepLinkInvestorQuery.data, setSearchParams]);

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

  // Match the directory to the round selected on Pipeline/Fundraising. A
  // contact can have a closed deal in one round and an active deal in another;
  // the stage badge and filters must refer to the same round.
  const roundsQuery = useQuery({
    queryKey: qk.rounds(startupId),
    queryFn: () => listFundraisingRounds(startupId),
  });
  const activeRound = useMemo(() => {
    const rounds = roundsQuery.data?.data ?? [];
    return rounds.find((round) => round.id === preferredRoundId) ??
      rounds.find((round) => round.status === "active") ??
      rounds[0] ??
      null;
  }, [preferredRoundId, roundsQuery.data]);

  const investorsQuery = useQuery({
    queryKey: qk.investors(startupId, { tab, search: debouncedSearch, ...filters, roundId: activeRound?.id ?? null, page }),
    queryFn: () =>
      listInvestors(startupId, {
        page,
        limit: PAGE_SIZE,
        engagement: tab,
        ...(activeRound ? { roundId: activeRound.id } : {}),
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

  // A contact's expectedAmount belongs to whichever round its pipeline entry
  // is in this directory can span several rounds, each with its own
  // currency, so amounts are never assumed to be USD.
  const currencyByRoundId = useMemo(
    () => new Map((roundsQuery.data?.data ?? []).map((round) => [round.id, round.currency])),
    [roundsQuery.data],
  );

  const meta = investorsQuery.data?.meta;
  const counts = meta?.engagementCounts ?? { engaged: 0, prospect: 0 };
  const totalPages = meta?.totalPages ?? 1;

  const invalidateInvestors = () => invalidateDealData(queryClient, startupId);

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

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const settled = await runWithConcurrency(ids, 5, (id) => deleteInvestor(startupId, id));
      const failedIds = ids.filter((_, index) => settled[index].status === "rejected");
      const firstFailure = settled.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      )?.reason;
      return { succeeded: ids.length - failedIds.length, failedIds, firstFailure };
    },
    onSuccess: ({ succeeded, failedIds, firstFailure }) => {
      setBulkDeleteConfirm(false);
      setSelectedIds(new Set(failedIds));
      invalidateInvestors();
      if (failedIds.length === 0) {
        toast.success(`${succeeded} investor${succeeded === 1 ? "" : "s"} deleted`);
      } else {
        toast.error(
          `${succeeded} deleted, ${failedIds.length} could not be removed ${mutationErrorMessage(firstFailure, "some have related records")}`,
        );
      }
    },
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

  const bulkAddToPipelineMutation = useMutation({
    mutationFn: async (investors: InvestorRow[]) => {
      const settled = await runWithConcurrency(investors, 5, (investor) =>
        createPipelineEntry(startupId, {
          investorId: investor.id,
          stage: "sourced",
          expectedAmount: investor.amount ?? undefined,
          probabilityPercentage: DEFAULT_PROBABILITY_BY_STAGE.sourced,
        }),
      );
      const failedIds = investors
        .filter((_, index) => settled[index].status === "rejected")
        .map((investor) => investor.id);
      const firstFailure = settled.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      )?.reason;
      return { succeeded: investors.length - failedIds.length, failedIds, firstFailure };
    },
    onSuccess: ({ succeeded, failedIds, firstFailure }) => {
      setSelectedIds(new Set(failedIds));
      invalidateInvestors();
      if (failedIds.length === 0) {
        toast.success(`${succeeded} investor${succeeded === 1 ? "" : "s"} added to pipeline`);
      } else {
        toast.error(
          `${succeeded} added, ${failedIds.length} could not be added ${mutationErrorMessage(firstFailure, "some are already in the pipeline")}`,
        );
      }
    },
  });

  const quickEmailMutation = useMutation({
    mutationFn: (values: ComposeFormValues) =>
      sendInvestorEmail(startupId, quickEmailInvestor!.id, values),
    onSuccess: (result) => {
      toast.success(
        result.logCreated ? "Email sent and logged" : "Email sent it'll appear in the timeline shortly",
      );
      setQuickEmailInvestor(null);
      invalidateInteractionData(queryClient, startupId);
    },
    onError: (err) => toast.error(sendEmailErrorMessage(err)),
  });

  const handleFilterChange = <K extends keyof InvestorFilters>(
    key: K,
    value: InvestorFilters[K],
  ) => setFilters((prev) => ({ ...prev, [key]: value }));

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllVisible = () => setSelectedIds(new Set(rows.map((inv) => inv.id)));

  const toggleSelectionMode = () =>
    setSelectedIds((current) => (current === null ? new Set() : null));

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (investor: InvestorRow) => {
    setEditing(investor);
    setFormOpen(true);
  };

  const activeTab = TABS.find((t) => t.id === tab)!;
  const selectionActive = selectedIds !== null;
  const selectedCount = selectedIds?.size ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investors"
        description="Your directory of investor relationships, split by whether you've reached out."
        actions={
          canCreate ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
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
                    ? "bg-card font-medium text-foreground shadow-xs"
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
        {activeRound && (
          <p className="mt-1 text-xs text-muted-foreground">
            Pipeline status shown for <span className="font-medium text-foreground">{activeRound.roundName}</span>
            {" "}the selected fundraising round.
          </p>
        )}
      </div>

      {googleStatus.data?.configured && !googleStatus.data.connected && (
        <GoogleNotConnectedNotice action="send emails and schedule meetings" />
      )}

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
        canSelect={canSelect}
        selectionActive={selectionActive}
        onToggleSelection={toggleSelectionMode}
        onSelectAllVisible={selectAllVisible}
        visibleCount={rows.length}
        selectedCount={selectedCount}
        onBulkDelete={canDelete ? () => setBulkDeleteConfirm(true) : undefined}
        bulkDeleting={bulkDeleteMutation.isPending}
        onBulkAddToPipeline={
          canCreate
            ? () =>
                bulkAddToPipelineMutation.mutate(
                  rows.filter((row) => selectedIds?.has(row.id)),
                )
            : undefined
        }
        bulkAddingToPipeline={bulkAddToPipelineMutation.isPending}
      />

      <div className="card-elevated overflow-hidden">
        {investorsQuery.isPending ? (
          <div className="space-y-0 divide-y divide-border/60" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-6">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="hidden h-5 w-20 shrink-0 sm:block" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 && !investorsQuery.isError ? (
          <EmptyState
            icon={Users}
            title={
              debouncedSearch || filters.stage || filters.investorType
                ? "No investors match"
                : tab === "engaged"
                  ? "You haven't reached out to anyone yet"
                  : "No prospects yet"
            }
            description={
              debouncedSearch || filters.stage || filters.investorType
                ? "Try a different search term or clear your filters."
                : tab === "engaged"
                  ? "Move a prospect into the pipeline, or log an interaction, and they'll appear here."
                  : "Add investors to build up a list to work through."
            }
            action={
              canCreate && !debouncedSearch && tab === "prospect" ? (
                <Button size="sm" onClick={openAdd}>
                  <Plus className="h-4 w-4" />
                  Add investor
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className={cn("hidden lg:block", investorsQuery.isFetching && "opacity-60")}>
              <InvestorsTable
                investors={rows}
                currencyByRoundId={currencyByRoundId}
                selectedIds={selectedIds}
                onToggleOne={toggleOne}
                onMoveToPipeline={(investor) => moveMutation.mutate(investor)}
                onEdit={openEdit}
                onDelete={setPendingDelete}
                onViewHistory={setViewing}
                onEmail={setQuickEmailInvestor}
                googleConnected={googleStatus.data?.connected === true}
                movingInvestorId={moveMutation.isPending ? moveMutation.variables?.id : null}
              />
            </div>

            <div className={cn("lg:hidden", investorsQuery.isFetching && "opacity-60")}>
              <InvestorsCardList
                investors={rows}
                currencyByRoundId={currencyByRoundId}
                selectedIds={selectedIds}
                onToggleOne={toggleOne}
                onMoveToPipeline={(investor) => moveMutation.mutate(investor)}
                onEdit={openEdit}
                onDelete={setPendingDelete}
                onViewHistory={setViewing}
                onEmail={setQuickEmailInvestor}
                googleConnected={googleStatus.data?.connected === true}
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

      <ImportInvestorsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        startupId={startupId}
        onImported={invalidateInvestors}
      />

      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={setBulkDeleteConfirm}
        title={`Delete ${selectedCount} investors?`}
        description="Contacts with pipeline entries, commitments or logged interactions will be skipped and stay selected so you can see which ones need those removed first."
        confirmLabel={`Delete ${selectedCount}`}
        pendingLabel="Deleting…"
        isPending={bulkDeleteMutation.isPending}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selectedIds ?? []))}
      />

      <ComposeEmailDialog
        open={quickEmailInvestor !== null}
        onOpenChange={(open) => !open && setQuickEmailInvestor(null)}
        investorName={quickEmailInvestor?.name ?? ""}
        investorEmail={quickEmailInvestor?.email ?? ""}
        isSubmitting={quickEmailMutation.isPending}
        onSubmit={(values) => quickEmailMutation.mutate(values)}
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

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.name}?`}
        description="This removes the contact from your directory. If they're on the pipeline board or have logged interactions, the delete will be refused remove those first."
        confirmLabel="Delete investor"
        pendingLabel="Deleting…"
        isPending={deleteMutation.isPending}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
      />
    </div>
  );
}
