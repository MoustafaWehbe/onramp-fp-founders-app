import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
import { useAppStore } from "../../../lib/app-store";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-error";
import { cn } from "../../../lib/utils";
import {
  completeFollowup,
  createInteractionLog,
  listInteractionLogs,
} from "../../../lib/interaction-log-api";
import {
  DEFAULT_PROBABILITY_BY_STAGE,
  STAGES,
  type PipelineStageId,
} from "../../../lib/mock-data";
import {
  createPipelineEntry,
  deletePipelineEntry,
  getPipelineAnalytics,
  listPipelineEntries,
  updatePipelineEntry,
  type PipelineEntry,
} from "../../../lib/pipeline-api";
import { listFundraisingRounds, type FundraisingRound } from "../../../lib/fundraising-api";
import { fetchAllPages } from "../../../lib/pagination";
import { LogInteractionDialog, type LogFormValues } from "../Investors/LogInteractionDialog";
import { AddDealDialog, type AddDealValues } from "./AddDealDialog";
import {
  buildColumns,
  columnOf,
  computeDropOrder,
  moveWithinColumns,
  type BoardColumns,
} from "./board-columns";
import { DealCardOverlay } from "./DealCard";
import { DealDetailDialog } from "./DealDetailDialog";
import { FocusList, type FocusItem } from "./FocusList";
import { PipelineAnalyticsView } from "./PipelineAnalyticsView";
import { PipelineColumn } from "./PipelineColumn";
import { PipelineSummary, type PipelineTotals } from "./PipelineSummary";
import { PipelineToolbar, type PipelineView } from "./PipelineToolbar";
import { ViewTabs, type PipelineViewId } from "./ViewTabs";
import {
  dealSignals,
  EMPTY_SIGNALS,
  groupLogsByInvestor,
  type DealSignals,
} from "./deal-signals";

const FORBIDDEN_HINT =
  "This account is not an active member of the current startup, or lacks pipeline permission.";

function pipelineErrorMessage(err: unknown, fallback: string): string {
  switch (apiErrorCode(err)) {
    case "ALREADY_IN_PIPELINE":
      return "That investor is already on the board.";
    case "PIPELINE_NOT_FOUND":
      return "That deal no longer exists — a teammate may have removed it.";
    case "HAS_DEPENDENTS":
      return "This deal has commitments attached, so it can't be removed.";
    default:
      return apiErrorMessage(err, fallback, FORBIDDEN_HINT);
  }
}

/**
 * closestCorners (or closestCenter alone) recomputes a distance to every
 * droppable on each pointer move, so hovering near the boundary between two
 * cards makes the "closest" one flip back and forth with tiny movements —
 * that's the rapid neighbor-swapping this was reported as. pointerWithin
 * only counts a collision when the pointer is actually inside a card's
 * bounds, which is far more stable; closestCenter is only a fallback for
 * when the pointer has left every droppable (e.g. past the last card).
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

export function Pipeline() {
  const startupId = useActiveStartupId();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const preferredRoundId = useAppStore((s) => s.activeRoundIds[startupId]);
  const setActiveRoundId = useAppStore((s) => s.setActiveRoundId);
  // Collaborators may add and move deals; viewers may only look.
  const canCreate = can("pipeline", "create");
  const canUpdate = can("pipeline", "update");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [columns, setColumns] = useState<BoardColumns>(() => buildColumns([]));
  const [addOpen, setAddOpen] = useState(false);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<PipelineEntry | null>(null);
  const [activeView, setActiveView] = useState<PipelineViewId>("board");
  // Logging straight from the focus list, without opening the deal first.
  const [quickLogDeal, setQuickLogDeal] = useState<PipelineEntry | null>(null);
  const [view, setView] = useState<PipelineView>({
    search: "",
    attentionOnly: false,
    showPassed: true,
  });

  const sensors = useSensors(
    // A short drag threshold before a pointer-down counts as a drag, so
    // clicking the card to open it (or its move menu) isn't swallowed.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const roundsQuery = useQuery({
    queryKey: ["fundraising-rounds", startupId],
    queryFn: () => listFundraisingRounds(startupId),
  });
  const activeRound = useMemo<FundraisingRound | null>(() => {
    const rounds = roundsQuery.data?.data ?? [];
    return rounds.find((round) => round.id === preferredRoundId) ?? rounds.find((round) => round.status === "active") ?? rounds[0] ?? null;
  }, [preferredRoundId, roundsQuery.data]);

  useEffect(() => {
    if (activeRound && activeRound.id !== preferredRoundId) setActiveRoundId(startupId, activeRound.id);
  }, [activeRound, preferredRoundId, setActiveRoundId, startupId]);

  const pipelineQuery = useQuery({
    queryKey: ["pipeline", startupId, activeRound?.id],
    // The whole board has to be on screen at once for a Kanban to make sense,
    // so page through in batches of 10 rather than asking for everything at once.
    queryFn: () =>
      fetchAllPages((page, limit) => listPipelineEntries(startupId, { page, limit, roundId: activeRound?.id })).then(
        (data) => ({ data }),
      ),
    enabled: Boolean(activeRound),
  });

  // The board's follow-up and last-touch signals come from interaction logs.
  // One workspace-wide fetch beats a request per card; logs come back
  // newest-first so the freshest signals always survive.
  const logsQuery = useQuery({
    queryKey: ["interaction-logs", startupId, "board"],
    queryFn: () =>
      fetchAllPages((page, limit) => listInteractionLogs(startupId, { page, limit })).then(
        (data) => ({ data }),
      ),
  });

  const analyticsQuery = useQuery({
    queryKey: ["pipeline-analytics", startupId, activeRound?.id],
    queryFn: () => getPipelineAnalytics(startupId, activeRound?.id),
    // Only fetched once the tab is actually opened; nothing else on the page
    // needs it.
    enabled: activeView === "analytics" && Boolean(activeRound),
  });

  const entries = useMemo(() => pipelineQuery.data?.data ?? [], [pipelineQuery.data]);

  const signalsByDeal = useMemo(() => {
    const logsByInvestor = groupLogsByInvestor(logsQuery.data?.data ?? []);
    const now = Date.now();
    const map = new Map<string, DealSignals>();
    for (const entry of entries) {
      map.set(entry.id, dealSignals(entry, logsByInvestor.get(entry.investorId), now));
    }
    return map;
  }, [entries, logsQuery.data]);

  const signalsFor = useCallback(
    (dealId: string | null) =>
      (dealId === null ? undefined : signalsByDeal.get(dealId)) ?? EMPTY_SIGNALS,
    [signalsByDeal],
  );

  const totals = useMemo<PipelineTotals>(() => {
    let liveCount = 0;
    let liveValue = 0;
    let weightedValue = 0;
    let committedCount = 0;
    let committedValue = 0;
    let attentionCount = 0;

    for (const entry of entries) {
      const amount = entry.expectedAmount ?? 0;
      if (signalsByDeal.get(entry.id)?.needsAttention) attentionCount += 1;
      if (entry.stage === "passed") continue;

      liveCount += 1;
      liveValue += amount;
      weightedValue += amount * ((entry.probabilityPercentage ?? 0) / 100);
      if (entry.stage === "committed") {
        committedCount += 1;
        committedValue += amount;
      }
    }

    return {
      liveCount,
      liveValue,
      weightedValue: Math.round(weightedValue),
      committedCount,
      committedValue,
      attentionCount,
    };
  }, [entries, signalsByDeal]);

  const visibleEntries = useMemo(() => {
    const needle = view.search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!view.showPassed && entry.stage === "passed") return false;
      if (view.attentionOnly && !signalsByDeal.get(entry.id)?.needsAttention) return false;
      if (needle === "") return true;
      const haystack = `${entry.investor.fullName} ${entry.investor.ventureFirm ?? ""}`;
      return haystack.toLowerCase().includes(needle);
    });
  }, [entries, signalsByDeal, view]);

  const visibleStages = useMemo(
    () => (view.showPassed ? STAGES : STAGES.filter((stage) => stage.id !== "passed")),
    [view.showPassed],
  );

  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  // The live board arrangement. Rebuilt from server truth whenever it's safe
  // to — not while a drag or its mutation owns the arrangement, or the board
  // would snap back to the pre-drag order for a frame before catching up.
  useEffect(() => {
    if (activeId !== null) return;
    setColumns(buildColumns(visibleEntries));
  }, [visibleEntries, activeId]);

  const openDeal = useMemo(
    () => entries.find((entry) => entry.id === openDealId) ?? null,
    [entries, openDealId],
  );

  /** Overdue first, then longest-quiet — the order you'd actually work them. */
  const focusItems = useMemo<FocusItem[]>(() => {
    const rank: Record<string, number> = { overdue: 0, today: 1, upcoming: 2, none: 3 };
    return entries
      .map((deal) => ({ deal, signals: signalsFor(deal.id) }))
      .filter((item) => item.signals.needsAttention)
      .sort((a, b) => {
        const byUrgency = rank[a.signals.followup] - rank[b.signals.followup];
        if (byUrgency !== 0) return byUrgency;
        return b.signals.daysQuiet - a.signals.daysQuiet;
      });
  }, [entries, signalsFor]);

  const invalidatePipeline = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["pipeline", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["investors", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["pipeline-analytics", startupId] });
  }, [queryClient, startupId]);

  /** Follow-up state lives in the logs, so the board's signals must refetch too. */
  const invalidateLogs = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["interaction-logs", startupId] });
    void queryClient.invalidateQueries({ queryKey: ["investors", startupId] });
  }, [queryClient, startupId]);

  const moveMutation = useMutation({
    mutationFn: ({
      pipelineId,
      stage,
      sortOrder,
      changedStage,
    }: {
      pipelineId: string;
      stage: PipelineStageId;
      sortOrder: number;
      changedStage: boolean;
    }) =>
      updatePipelineEntry(startupId, pipelineId, {
        sortOrder,
        ...(changedStage && { stage, probabilityPercentage: DEFAULT_PROBABILITY_BY_STAGE[stage] }),
      }),
    onMutate: async ({ pipelineId, stage, sortOrder, changedStage }) => {
      await queryClient.cancelQueries({ queryKey: ["pipeline", startupId] });
      const pipelineKey = ["pipeline", startupId, activeRound?.id] as const;
      const previous = queryClient.getQueryData<{ data: PipelineEntry[] }>(pipelineKey);

      queryClient.setQueryData<{ data: PipelineEntry[]; meta?: unknown }>(
        pipelineKey,
        (current) => {
          if (!current) return current;
          return {
            ...current,
            data: current.data.map((entry) =>
              entry.id === pipelineId
                ? {
                    ...entry,
                    sortOrder,
                    ...(changedStage && {
                      stage,
                      probabilityPercentage: DEFAULT_PROBABILITY_BY_STAGE[stage],
                    }),
                  }
                : entry,
            ),
          };
        },
      );

      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["pipeline", startupId, activeRound?.id], context.previous);
      }
      toast.error(pipelineErrorMessage(err, "Could not move deal"));
    },
    onSettled: () => {
      invalidatePipeline();
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: AddDealValues) =>
      createPipelineEntry(startupId, {
        roundId: activeRound?.id,
        investorId: values.investorId,
        stage: values.stage,
        expectedAmount: values.expectedAmount,
        probabilityPercentage: DEFAULT_PROBABILITY_BY_STAGE[values.stage],
      }),
    onSuccess: () => {
      toast.success("Added to pipeline");
      setAddOpen(false);
      invalidatePipeline();
    },
    onError: (err) => toast.error(pipelineErrorMessage(err, "Could not add to pipeline")),
  });

  const removeMutation = useMutation({
    mutationFn: (deal: PipelineEntry) => deletePipelineEntry(startupId, deal.id),
    onSuccess: (_result, deal) => {
      toast.success(`${deal.investor.fullName} removed from the pipeline`);
      setPendingRemove(null);
      setOpenDealId(null);
      invalidatePipeline();
    },
    onError: (err) => toast.error(pipelineErrorMessage(err, "Could not remove the deal")),
  });

  const completeFollowupMutation = useMutation({
    mutationFn: (logId: string) => completeFollowup(startupId, logId),
    onSuccess: () => {
      toast.success("Follow-up marked done");
      invalidateLogs();
    },
    onError: (err) => toast.error(pipelineErrorMessage(err, "Could not close the follow-up")),
  });

  const quickLogMutation = useMutation({
    mutationFn: (values: LogFormValues) =>
      createInteractionLog(startupId, {
        investorId: quickLogDeal!.investorId,
        pipelineId: quickLogDeal!.id,
        ...values,
      }),
    onSuccess: () => {
      // The API closes whatever follow-ups this interaction satisfied, so the
      // row usually leaves the focus list on its own.
      toast.success("Interaction logged");
      setQuickLogDeal(null);
      invalidateLogs();
    },
    onError: (err) => toast.error(pipelineErrorMessage(err, "Could not save the interaction")),
  });

  /** Used by the card's "Move to stage" menu — always lands at the bottom of the target column. */
  const moveDeal = useCallback(
    (pipelineId: string, stage: PipelineStageId) => {
      if (!canUpdate) return;
      const current = entriesById.get(pipelineId);
      if (!current || current.stage === stage) return;

      const maxOrderInStage = entries.reduce(
        (max, entry) => (entry.stage === stage ? Math.max(max, entry.sortOrder) : max),
        0,
      );

      moveMutation.mutate({
        pipelineId,
        stage,
        sortOrder: maxOrderInStage + 1000,
        changedStage: true,
      });
    },
    [canUpdate, entries, entriesById, moveMutation],
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (!canUpdate) return;
    setActiveId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    setColumns((current) => moveWithinColumns(current, String(active.id), String(over.id)));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dealId = activeId;
    setActiveId(null);
    if (!dealId || !event.over) return;

    const deal = entriesById.get(dealId);
    const stage = columnOf(columns, dealId);
    if (!deal || !stage) return;

    const sortOrder = computeDropOrder(columns, dealId, (id) => entriesById.get(id)?.sortOrder);
    moveMutation.mutate({
      pipelineId: dealId,
      stage,
      sortOrder,
      changedStage: stage !== deal.stage,
    });
  };

  const activeDeal = activeId ? (entriesById.get(activeId) ?? null) : null;

  const boardReady = !pipelineQuery.isLoading && !pipelineQuery.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deal pipeline"
        description={
          canUpdate
            ? "Open a card to log a call, set the next step, or move the deal along."
            : "A read-only view of where each investor stands."
        }
        actions={
          canCreate ? (
            <Button size="sm" type="button" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add to pipeline
            </Button>
          ) : null
        }
      />

      {roundsQuery.isSuccess && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-surface/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Viewing round</span>
          <select
            aria-label="Active fundraising round"
            value={activeRound?.id ?? ""}
            onChange={(event) => setActiveRoundId(startupId, event.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 font-medium outline-none focus:ring-1 focus:ring-ring"
          >
            {(roundsQuery.data?.data ?? []).map((round) => (
              <option key={round.id} value={round.id}>
                {round.roundName} ({round.status})
              </option>
            ))}
          </select>
          {!activeRound && <span className="text-muted-foreground">Create a round before adding pipeline deals.</span>}
        </div>
      )}

      {pipelineQuery.isLoading && (
        <div className="rounded-xl border border-border/70 bg-surface/50 px-4 py-10 text-center text-sm text-muted-foreground">
          Loading pipeline…
        </div>
      )}

      {pipelineQuery.isError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
          <p>{pipelineErrorMessage(pipelineQuery.error, "Failed to load pipeline.")}</p>
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => void pipelineQuery.refetch()}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {boardReady && entries.length > 0 && (
        <>
          <PipelineSummary
            totals={totals}
            attentionActive={view.attentionOnly}
            onToggleAttention={() => {
              // The tile is the shortcut into the focus list; on the board it
              // just filters in place.
              if (activeView === "board") {
                setView((prev) => ({ ...prev, attentionOnly: !prev.attentionOnly }));
              } else {
                setActiveView("focus");
              }
            }}
          />

          <ViewTabs
            value={activeView}
            onChange={setActiveView}
            focusCount={focusItems.length}
          />
        </>
      )}

      {boardReady && activeView === "focus" && (
        <FocusList
          items={focusItems}
          canUpdate={canUpdate}
          canCreate={canCreate}
          completingLogId={
            completeFollowupMutation.isPending
              ? (completeFollowupMutation.variables ?? null)
              : null
          }
          onOpen={(deal) => setOpenDealId(deal.id)}
          onLog={setQuickLogDeal}
          onMarkDone={(logId) => completeFollowupMutation.mutate(logId)}
        />
      )}

      {boardReady && activeView === "analytics" && (
        <>
          {analyticsQuery.isPending && (
            <div className="rounded-xl border border-border/70 bg-surface/50 px-4 py-10 text-center text-sm text-muted-foreground">
              Crunching stage history…
            </div>
          )}
          {analyticsQuery.isError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
              <p>{pipelineErrorMessage(analyticsQuery.error, "Failed to load analytics.")}</p>
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => void analyticsQuery.refetch()}>
                  Retry
                </Button>
              </div>
            </div>
          )}
          {analyticsQuery.data && <PipelineAnalyticsView analytics={analyticsQuery.data} />}
        </>
      )}

      {boardReady && activeView === "board" && entries.length > 0 && (
        <PipelineToolbar
          view={view}
          onChange={(key, value) => setView((prev) => ({ ...prev, [key]: value }))}
          visibleCount={visibleEntries.length}
          totalCount={entries.length}
        />
      )}

      {boardReady && activeView === "board" && (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          // The board itself is the scrollable ancestor that needs to move
          // when a drag reaches an off-screen stage; a wider edge zone and
          // steady acceleration keep that scroll going continuously instead
          // of starting and stopping as the pointer wobbles near the edge.
          autoScroll={{ threshold: { x: 0.25, y: 0.15 }, acceleration: 20 }}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div
            className={cn(
              "scrollbar-none flex touch-pan-x gap-3 overflow-x-auto scroll-smooth pb-1",
              // Mandatory snap fights dnd-kit's own scrollLeft updates while
              // it's auto-scrolling toward an off-screen column — the browser
              // keeps snapping back to the nearest card, which is what made
              // the drag-to-edge scroll feel stuck rather than smooth. Only
              // snap when nothing is being dragged.
              activeId === null && "snap-x snap-proximity",
            )}
          >
            {visibleStages.map((stage) => {
              const dealIds = columns[stage.id] ?? [];
              const weightedTotal = dealIds.reduce((sum, id) => {
                const deal = entriesById.get(id);
                if (!deal) return sum;
                const amount = deal.expectedAmount ?? 0;
                return sum + amount * ((deal.probabilityPercentage ?? 0) / 100);
              }, 0);

              return (
                <PipelineColumn
                  key={stage.id}
                  stage={stage}
                  dealIds={dealIds}
                  entriesById={entriesById}
                  signalsFor={signalsFor}
                  canUpdate={canUpdate}
                  weightedTotal={weightedTotal}
                  emptyMessage={
                    view.attentionOnly || view.search.trim() !== ""
                      ? "Nothing matches here"
                      : "Drop an investor here"
                  }
                  onOpen={setOpenDealId}
                  onMove={moveDeal}
                />
              );
            })}
          </div>

          <DragOverlay>
            {activeDeal && (
              <DealCardOverlay
                deal={activeDeal}
                signals={signalsFor(activeDeal.id)}
                canUpdate={canUpdate}
                onOpen={() => {}}
                onMove={() => {}}
              />
            )}
          </DragOverlay>
        </DndContext>
      )}

      <DealDetailDialog
        startupId={startupId}
        deal={openDeal}
        signals={signalsFor(openDealId)}
        onOpenChange={(open) => !open && setOpenDealId(null)}
        onRemove={setPendingRemove}
      />

      <LogInteractionDialog
        open={quickLogDeal !== null}
        onOpenChange={(open) => !open && setQuickLogDeal(null)}
        investorName={quickLogDeal?.investor.fullName ?? ""}
        isSubmitting={quickLogMutation.isPending}
        onSubmit={(values) => quickLogMutation.mutate(values)}
      />

      <AddDealDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        startupId={startupId}
        isSubmitting={createMutation.isPending}
        onSubmit={(values) => createMutation.mutate(values)}
      />

      <Dialog
        open={pendingRemove !== null}
        onOpenChange={(open) => !open && setPendingRemove(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {pendingRemove?.investor.fullName} from the pipeline?</DialogTitle>
            <DialogDescription>
              The contact stays in your investor directory along with everything you've logged —
              only their place on this board is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingRemove(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() => pendingRemove && removeMutation.mutate(pendingRemove)}
            >
              {removeMutation.isPending ? "Removing…" : "Remove from pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
