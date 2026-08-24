import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
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
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, Crown, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/shared/ConfirmDialog";
import { EmptyState } from "../../../components/shared/EmptyState";
import { GoogleNotConnectedNotice } from "../../../components/shared/GoogleNotConnectedNotice";
import { usePermissions } from "../../../hooks/usePermissions";
import { useAuth } from "../../../hooks/useAuth";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { useGoogleConnectionStatus } from "../../../hooks/useGoogleConnection";
import { useAppStore } from "../../../lib/app-store";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-error";
import { cn } from "../../../lib/utils";
import { listInteractionLogs } from "../../../lib/interaction-log-api";
import { scheduleMeeting } from "../../../lib/calendar-api";
import { sendInvestorEmail } from "../../../lib/gmail-api";
import {
  DEFAULT_PROBABILITY_BY_STAGE,
  STAGES,
  type PipelineStageId,
} from "../../../lib/pipeline-stages";
import {
  createPipelineEntry,
  deletePipelineEntry,
  getPipelineAnalytics,
  getPipelineFocus,
  listPipelineEntries,
  updatePipelineEntry,
  type CommitmentDraft,
  type PipelineEntry,
} from "../../../lib/pipeline-api";
import {
  listFundraisingRounds,
  ROUND_STATUS_LABELS,
  type FundraisingRound,
} from "../../../lib/fundraising-api";
import { Select } from "../../../components/ui/select";
import { fetchAllPages } from "../../../lib/pagination";
import {
  invalidateDealData,
  invalidateFinancialData,
  invalidateInteractionData,
  qk,
} from "../../../lib/query-keys";
import { listMembers } from "../../../lib/team-api";
import { ComposeEmailDialog, type ComposeFormValues } from "../Investors/ComposeEmailDialog";
import { ScheduleMeetingDialog, type ScheduleFormValues } from "../Investors/ScheduleMeetingDialog";
import { AddDealDialog, type AddDealValues } from "./AddDealDialog";
import { BulkActionsBar } from "./BulkActionsBar";
import { TaskDialog } from "./TaskDialog";
import {
  buildColumns,
  columnOf,
  computeDropOrder,
  moveWithinColumns,
  type BoardColumns,
} from "./board-columns";
import { CommitDialog } from "./CommitDialog";
import { DealCardOverlay } from "./DealCard";
import { DealDetailDialog } from "./DealDetailDialog";
import { FocusList } from "./FocusList";
import { MobilePipelineBoard } from "./MobilePipelineBoard";
import { PassReasonDialog } from "./PassReasonDialog";
import { PipelineAnalyticsView } from "./PipelineAnalyticsView";
import { PipelineColumn } from "./PipelineColumn";
import { PipelineSummary, type PipelineTotals } from "./PipelineSummary";
import { PipelineToolbar, type PipelineView } from "./PipelineToolbar";
import { TaskQueue } from "./TaskQueue";
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
      return "That deal no longer exists a teammate may have removed it.";
    case "HAS_DEPENDENTS":
      return "This deal has commitments or open tasks attached, so it can't be removed.";
    case "PASSED_REASON_REQUIRED":
      return "Marking a deal as passed needs a reason open the deal to add one.";
    case "COMMITMENT_DETAILS_REQUIRED":
      return "Moving a deal to Committed needs a commitment amount.";
    case "ROUND_NOT_OPEN":
      return "That round is closed, so it can't take new deals.";
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

function scheduleMeetingErrorMessage(err: unknown): string {
  switch (apiErrorCode(err)) {
    case "INVESTOR_EMAIL_MISSING":
      return "This investor has no email on file.";
    case "GOOGLE_NOT_CONNECTED":
      return "Connect your Google account in Settings to schedule meetings.";
    case "GOOGLE_NEEDS_REAUTH":
    case "GOOGLE_INSUFFICIENT_SCOPE":
      return "Your Google connection needs to be reconnected see Settings.";
    case "CALENDAR_EVENT_FAILED":
      return "Google rejected the request. Please try again.";
    default:
      return apiErrorMessage(err, "Could not schedule the meeting", FORBIDDEN_HINT);
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
  const { user } = useAuth();
  const { can } = usePermissions();
  const googleStatus = useGoogleConnectionStatus();
  const queryClient = useQueryClient();
  const preferredRoundId = useAppStore((s) => s.activeRoundIds[startupId]);
  const setActiveRoundId = useAppStore((s) => s.setActiveRoundId);
  // Collaborators may add and move deals; viewers may only look.
  const canCreate = can("pipeline", "create");
  const canUpdate = can("pipeline", "update");
  const canCreateRound = can("financial", "create");
  // Below this, the board becomes the tap-driven single-stage list see
  // MobilePipelineBoard for why pointer/keyboard drag isn't offered there.
  const isCompactBoard = useMediaQuery("(max-width: 767px)");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [columns, setColumns] = useState<BoardColumns>(() => buildColumns([]));
  const columnsRef = useRef(columns);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ activeId: string; overId: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // A chat unfurl card or notification can deep-link straight to a deal (and,
  // optionally, a tab within it) via `?deal=`/`?tab=` read once on mount,
  // same pattern as `activeView` below.
  const [openDealId, setOpenDealId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("deal"),
  );
  const [openDealInitialTab] = useState<"overview" | "tasks" | "discussion" | "activity" | undefined>(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return requested === "tasks" || requested === "discussion" || requested === "activity"
      ? requested
      : undefined;
  });
  const [pendingRemove, setPendingRemove] = useState<PipelineEntry | null>(null);
  const [activeView, setActiveView] = useState<PipelineViewId>(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    return requested === "focus" || requested === "tasks" || requested === "analytics" ? requested : "board";
  });
  // Scheduling straight from the focus list, without opening the deal first.
  const [quickScheduleDeal, setQuickScheduleDeal] = useState<PipelineEntry | null>(null);
  // Same idea for email send straight from the focus row.
  const [quickEmailDeal, setQuickEmailDeal] = useState<PipelineEntry | null>(null);
  // Same idea for the next step: a card or focus row can set one without the
  // detour through the deal sheet.
  const [quickTaskDealId, setQuickTaskDealId] = useState<string | null>(null);
  // null means the board is not in selection mode at all; an empty set means
  // it is, with nothing picked yet.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string> | null>(null);
  // A move into Passed is held here until a reason is given the server
  // rejects the transition without one, whichever way it was triggered.
  const [pendingPass, setPendingPass] = useState<{
    pipelineId: string;
    sortOrder: number;
  } | null>(null);
  // Same holding pattern for Committed, which records money against the round.
  const [pendingCommit, setPendingCommit] = useState<{
    pipelineId: string;
    sortOrder: number;
  } | null>(null);
  const [view, setView] = useState<PipelineView>({
    search: "",
    attentionOnly: false,
    showPassed: true,
    mineOnly: false,
  });

  const sensors = useSensors(
    // A short drag threshold before a pointer-down counts as a drag, so
    // clicking the card to open it (or its move menu) isn't swallowed.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Tabbing to a card and pressing space picks it up; arrow keys step to
    // the nearest droppable in that direction including across into a
    // neighboring column and space/enter drops it there, Escape cancels.
    // Same drag/drop handlers below as a pointer drag, so a keyboard move
    // persists identically. Each card's "Move to stage" menu remains the
    // more explicit, no-spatial-reasoning-required fallback.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const roundsQuery = useQuery({
    queryKey: qk.rounds(startupId),
    queryFn: () => listFundraisingRounds(startupId),
  });
  const activeRound = useMemo<FundraisingRound | null>(() => {
    const rounds = roundsQuery.data?.data ?? [];
    return rounds.find((round) => round.id === preferredRoundId) ?? rounds.find((round) => round.status === "active") ?? rounds[0] ?? null;
  }, [preferredRoundId, roundsQuery.data]);

  useEffect(() => {
    if (activeRound && activeRound.id !== preferredRoundId) setActiveRoundId(startupId, activeRound.id);
  }, [activeRound, preferredRoundId, setActiveRoundId, startupId]);

  // Every amount on this board belongs to activeRound and must be shown in
  // its currency "USD" here is only the fallback for the moment before a
  // round has loaded, never a guess once one has.
  const currency = activeRound?.currency ?? "USD";

  const pipelineQuery = useQuery({
    queryKey: qk.pipeline(startupId, activeRound?.id),
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
    queryKey: qk.logsForBoard(startupId),
    queryFn: () =>
      fetchAllPages((page, limit) => listInteractionLogs(startupId, { page, limit })).then(
        (data) => ({ data }),
      ),
  });

  const analyticsQuery = useQuery({
    queryKey: qk.pipelineAnalytics(startupId, activeRound?.id),
    queryFn: () => getPipelineAnalytics(startupId, activeRound?.id),
    // Only fetched once the tab is actually opened; nothing else on the page
    // needs it.
    enabled: activeView === "analytics" && Boolean(activeRound),
  });

  // Deals needing attention, computed server-side from tasks and last-touch
  // dates never a page-through of every interaction log. Fetched whenever
  // the board itself is (not just the Focus tab) so cards can flag it too.
  const focusQuery = useQuery({
    queryKey: qk.pipelineFocus(startupId, activeRound?.id),
    queryFn: () => getPipelineFocus(startupId, activeRound?.id),
    enabled: Boolean(activeRound),
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

  const focusByDeal = useMemo(
    () => new Map((focusQuery.data ?? []).map((row) => [row.id, row])),
    [focusQuery.data],
  );

  const focusReasonFor = useCallback(
    (dealId: string) => focusByDeal.get(dealId)?.reason ?? null,
    [focusByDeal],
  );

  // Deals carry a StartupMember id; the board wants a name to initial.
  const membersQuery = useQuery({
    queryKey: qk.members(startupId),
    queryFn: () => listMembers(startupId),
  });

  const ownerNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of membersQuery.data ?? []) {
      const name = member.user
        ? `${member.user.firstName} ${member.user.lastName}`.trim()
        : (member.invitedEmail ?? "");
      if (name) map.set(member.id, name);
    }
    return map;
  }, [membersQuery.data]);

  // Pipeline ownership uses StartupMember ids while auth exposes a user id.
  const myMemberId = useMemo(
    () => membersQuery.data?.find((member) => member.user?.id === user?.id)?.id ?? null,
    [membersQuery.data, user?.id],
  );

  // Typing shouldn't fire a request per keystroke the same debounce used on
  // the Investors directory's search box.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(view.search.trim()), 300);
    return () => clearTimeout(timer);
  }, [view.search]);

  const hasActiveFilter =
    debouncedSearch !== "" || view.attentionOnly || view.mineOnly || !view.showPassed;

  // Search, Mine, Attention and Show passed are answered by the API, not by
  // re-filtering whatever page happened to load the same reasoning as the
  // Investors directory's server-side filters. Kept as a second query,
  // separate from the unfiltered one above, so typing a search term can never
  // change what the summary tiles or the lead banner report: those always
  // read the whole round.
  const filteredPipelineQuery = useQuery({
    queryKey: qk.pipeline(startupId, activeRound?.id, {
      search: debouncedSearch || null,
      ownerId: view.mineOnly ? myMemberId : null,
      attentionOnly: view.attentionOnly,
      showPassed: view.showPassed,
    }),
    queryFn: () =>
      fetchAllPages((page, limit) =>
        listPipelineEntries(startupId, {
          page,
          limit,
          roundId: activeRound?.id,
          ...(debouncedSearch && { search: debouncedSearch }),
          ...(view.mineOnly && myMemberId && { ownerId: myMemberId }),
          ...(view.attentionOnly && { attentionOnly: true }),
          ...(!view.showPassed && { showPassed: false }),
        }),
      ).then((data) => ({ data })),
    enabled: Boolean(activeRound) && hasActiveFilter,
  });

  const totals = useMemo<PipelineTotals>(() => {
    let liveCount = 0;
    let liveValue = 0;
    let weightedValue = 0;
    let committedCount = 0;
    let committedValue = 0;

    for (const entry of entries) {
      const amount = entry.expectedAmount ?? 0;
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
      attentionCount: focusByDeal.size,
    };
  }, [entries, focusByDeal]);

  // Search, Mine, Attention and Show passed are all answered by the API —
  // this just picks which of the two board fetches above is on screen.
  const visibleEntries = useMemo(
    () => (hasActiveFilter ? (filteredPipelineQuery.data?.data ?? []) : entries),
    [hasActiveFilter, filteredPipelineQuery.data, entries],
  );

  const visibleStages = useMemo(
    () => (view.showPassed ? STAGES : STAGES.filter((stage) => stage.id !== "passed")),
    [view.showPassed],
  );

  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  // Rebuilt straight from visibleEntries rather than the drag-frozen `columns`
  // state above the mobile list never drags, so it has no reason to hold
  // still mid-gesture the way the desktop board's columns do.
  const entriesByStage = useMemo(() => {
    const map = new Map<PipelineStageId, PipelineEntry[]>();
    for (const stage of visibleStages) map.set(stage.id, []);
    for (const entry of visibleEntries) map.get(entry.stage)?.push(entry);
    return map;
  }, [visibleEntries, visibleStages]);

  // Passed deals cannot be leading the round they walked away from.
  const leads = useMemo(
    () => entries.filter((entry) => entry.isLead && entry.stage !== "passed"),
    [entries],
  );

  const ownerNameFor = useCallback(
    (dealId: string) => {
      const ownerId = entriesById.get(dealId)?.ownerId;
      return ownerId ? (ownerNames.get(ownerId) ?? null) : null;
    },
    [entriesById, ownerNames],
  );

  // The live board arrangement. Rebuilt from server truth whenever it's safe
  // to not while a drag or its mutation owns the arrangement, or the board
  // would snap back to the pre-drag order for a frame before catching up.
  useEffect(() => {
    if (activeId !== null) return;
    const next = buildColumns(visibleEntries);
    columnsRef.current = next;
    setColumns(next);
  }, [visibleEntries, activeId]);

  const openDeal = useMemo(
    () => entries.find((entry) => entry.id === openDealId) ?? null,
    [entries, openDealId],
  );

  // Already pre-sorted by urgency server-side.
  const focusItems = focusQuery.data ?? [];

  const invalidatePipeline = useCallback(
    () => invalidateDealData(queryClient, startupId),
    [queryClient, startupId],
  );

  /** Last-touch signals live in the logs, so the board's signals must refetch too. */
  const invalidateLogs = useCallback(
    () => invalidateInteractionData(queryClient, startupId),
    [queryClient, startupId],
  );

  const moveMutation = useMutation({
    mutationFn: ({
      pipelineId,
      stage,
      sortOrder,
      changedStage,
      reason,
      commitment,
    }: {
      pipelineId: string;
      stage: PipelineStageId;
      sortOrder: number;
      changedStage: boolean;
      /** Required by the server when the transition is into "passed". */
      reason?: string;
      /** Required by the server when the transition is into "committed". */
      commitment?: CommitmentDraft;
    }) =>
      updatePipelineEntry(startupId, pipelineId, {
        sortOrder,
        ...(changedStage && { stage, probabilityPercentage: DEFAULT_PROBABILITY_BY_STAGE[stage] }),
        ...(reason && { reason }),
        ...(commitment && { commitment }),
      }),
    onMutate: async ({ pipelineId, stage, sortOrder, changedStage }) => {
      await queryClient.cancelQueries({ queryKey: qk.pipeline(startupId, activeRound?.id) });
      const pipelineKey = qk.pipeline(startupId, activeRound?.id);
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
        queryClient.setQueryData(qk.pipeline(startupId, activeRound?.id), context.previous);
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

  const quickScheduleMutation = useMutation({
    mutationFn: (values: ScheduleFormValues) =>
      scheduleMeeting(startupId, quickScheduleDeal!.investorId, {
        pipelineId: quickScheduleDeal!.id,
        type: values.type,
        startDateTime: values.startDateTime,
        durationMinutes: values.durationMinutes,
        subject: values.subject ?? undefined,
        description: values.description ?? undefined,
      }),
    onSuccess: (result) => {
      // The API closes whatever follow-ups this interaction satisfied, so the
      // row usually leaves the focus list on its own.
      toast.success(
        result.logCreated
          ? "Meeting scheduled and logged"
          : "Meeting scheduled it'll appear in the timeline shortly",
      );
      setQuickScheduleDeal(null);
      invalidateLogs();
    },
    onError: (err) => toast.error(scheduleMeetingErrorMessage(err)),
  });

  const quickEmailMutation = useMutation({
    mutationFn: (values: ComposeFormValues) =>
      sendInvestorEmail(startupId, quickEmailDeal!.investorId, {
        pipelineId: quickEmailDeal!.id,
        ...values,
      }),
    onSuccess: (result) => {
      toast.success(
        result.logCreated ? "Email sent and logged" : "Email sent it'll appear in the timeline shortly",
      );
      setQuickEmailDeal(null);
      invalidateLogs();
    },
    onError: (err) => toast.error(sendEmailErrorMessage(err)),
  });

  /** Used by the card's "Move to stage" menu always lands at the bottom of the target column. */
  const moveDeal = useCallback(
    (pipelineId: string, stage: PipelineStageId) => {
      if (!canUpdate) return;
      const current = entriesById.get(pipelineId);
      if (!current || current.stage === stage) return;

      const maxOrderInStage = entries.reduce(
        (max, entry) => (entry.stage === stage ? Math.max(max, entry.sortOrder) : max),
        0,
      );
      const sortOrder = maxOrderInStage + 1000;

      // Passing needs a reason and committing needs an amount; both are
      // replayed once the prompt is answered.
      if (stage === "passed") {
        setPendingPass({ pipelineId, sortOrder });
        return;
      }
      if (stage === "committed") {
        setPendingCommit({ pipelineId, sortOrder });
        return;
      }

      moveMutation.mutate({ pipelineId, stage, sortOrder, changedStage: true });
    },
    [canUpdate, entries, entriesById, moveMutation],
  );

  const toggleSelected = useCallback((dealId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current ?? []);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }, []);

  // Only what's on screen: selecting behind an active filter would act on
  // deals the founder cannot see.
  const selectAllVisible = useCallback(
    () => setSelectedIds(new Set(visibleEntries.map((entry) => entry.id))),
    [visibleEntries],
  );

  const selectedDeals = useMemo(
    () =>
      selectedIds === null ? [] : visibleEntries.filter((entry) => selectedIds.has(entry.id)),
    [selectedIds, visibleEntries],
  );

  const quickTaskDeal = quickTaskDealId ? (entriesById.get(quickTaskDealId) ?? null) : null;

  const handleDragStart = (event: DragStartEvent) => {
    if (!canUpdate) return;
    columnsRef.current = columns;
    setActiveId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    pendingDragRef.current = { activeId: String(active.id), overId: String(over.id) };
    if (dragFrameRef.current !== null) return;

    // Pointer events can arrive much faster than the browser can paint. One
    // reorder per frame keeps React and dnd-kit's measurements in lockstep.
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const pending = pendingDragRef.current;
      if (!pending) return;
      const next = moveWithinColumns(columnsRef.current, pending.activeId, pending.overId);
      if (next !== columnsRef.current) {
        columnsRef.current = next;
        setColumns(next);
      }
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dealId = activeId;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    pendingDragRef.current = null;
    setActiveId(null);
    if (!dealId || !event.over) return;

    // Flush the pointer's final position; it may have arrived after the last
    // painted frame and therefore not reached React state yet.
    const finalColumns = moveWithinColumns(columnsRef.current, dealId, String(event.over.id));
    columnsRef.current = finalColumns;
    setColumns(finalColumns);

    const deal = entriesById.get(dealId);
    const stage = columnOf(finalColumns, dealId);
    if (!deal || !stage) return;

    const sortOrder = computeDropOrder(finalColumns, dealId, (id) => entriesById.get(id)?.sortOrder);

    // Dropping into Passed needs a reason, same as the stage menu. Nothing is
    // mutated yet, so clearing activeId lets the card spring back to where it
    // came from until the reason is confirmed.
    if (stage === "passed" && deal.stage !== "passed") {
      setPendingPass({ pipelineId: dealId, sortOrder });
      return;
    }
    if (stage === "committed" && deal.stage !== "committed") {
      setPendingCommit({ pipelineId: dealId, sortOrder });
      return;
    }

    moveMutation.mutate({
      pipelineId: dealId,
      stage,
      sortOrder,
      changedStage: stage !== deal.stage,
    });
  };

  const confirmPass = (reason: string) => {
    if (!pendingPass) return;
    moveMutation.mutate(
      { ...pendingPass, stage: "passed", changedStage: true, reason },
      { onSuccess: () => setPendingPass(null) },
    );
  };

  const confirmCommit = (commitment: CommitmentDraft) => {
    if (!pendingCommit) return;
    moveMutation.mutate(
      { ...pendingCommit, stage: "committed", changedStage: true, commitment },
      {
        onSuccess: () => {
          setPendingCommit(null);
          // The round page reads the same commitment this just wrote.
          invalidateFinancialData(queryClient, startupId);
          toast.success("Commitment recorded against the round");
        },
      },
    );
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
          canCreate && activeRound ? (
            <Button size="sm" type="button" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add to pipeline
            </Button>
          ) : canCreateRound && roundsQuery.isSuccess ? (
            <Button size="sm" asChild>
              <Link to="/fundraising">
                <Plus className="h-4 w-4" />
                Create fundraising round
              </Link>
            </Button>
          ) : null
        }
      />

      {googleStatus.data?.configured && !googleStatus.data.connected && (
        <GoogleNotConnectedNotice action="send emails and schedule meetings" />
      )}

      {roundsQuery.isSuccess && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-surface/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Viewing round</span>
          <Select
            aria-label="Active fundraising round"
            value={activeRound?.id ?? ""}
            onValueChange={(value) => setActiveRoundId(startupId, value)}
            className="h-8 w-auto min-w-48 font-medium"
            options={(roundsQuery.data?.data ?? []).map((round) => ({
              value: round.id,
              label: `${round.roundName} · ${ROUND_STATUS_LABELS[round.status]}`,
            }))}
          />
          {!activeRound && <span className="text-muted-foreground">Create a round before adding pipeline deals.</span>}
          {/* A priced round needs a lead, and this is the one place a founder
              looks at the whole raise at once so it answers it here. */}
          {activeRound && entries.length > 0 && (
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
                leads.length > 0 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
              )}
            >
              <Crown className="h-3.5 w-3.5" />
              {leads.length > 0
                ? `Lead: ${leads.map((deal) => deal.investor.fullName).join(", ")}`
                : "No lead yet"}
            </span>
          )}
        </div>
      )}

      {roundsQuery.isError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
          <p>{apiErrorMessage(roundsQuery.error, "Failed to load fundraising rounds.")}</p>
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => void roundsQuery.refetch()}>
              Retry
            </Button>
          </div>
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

      {roundsQuery.isSuccess && !activeRound && (
        <div className="rounded-xl border border-dashed border-border/70">
          <EmptyState
            icon={CircleDollarSign}
            title="Create a fundraising round first"
            description="Pipeline amounts, commitments, and forecasts need a round and currency to belong to."
            action={canCreateRound ? (
              <Button size="sm" asChild>
                <Link to="/fundraising">Create fundraising round</Link>
              </Button>
            ) : undefined}
          />
        </div>
      )}

      {boardReady && activeRound && entries.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/70">
          <EmptyState
            icon={Crown}
            title="Build your investor pipeline"
            description="Add the first investor to this round, then track outreach, next steps, and commitments here."
            action={canCreate ? (
              <Button size="sm" type="button" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" />
                Add first investor
              </Button>
            ) : undefined}
          />
        </div>
      )}

      {boardReady && entries.length > 0 && (
        <>
          <PipelineSummary
            totals={totals}
            currency={currency}
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

      {boardReady && entries.length > 0 && activeView === "focus" && focusQuery.isPending && (
        <div className="rounded-xl border border-border/70 bg-surface/50 px-4 py-10 text-center text-sm text-muted-foreground">
          Finding deals that need attention…
        </div>
      )}

      {boardReady && entries.length > 0 && activeView === "focus" && focusQuery.isError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
          <p>{pipelineErrorMessage(focusQuery.error, "Failed to load the attention queue.")}</p>
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => void focusQuery.refetch()}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {boardReady && entries.length > 0 && activeView === "focus" && focusQuery.isSuccess && (
        <FocusList
          items={focusItems}
          currency={currency}
          canCreate={canCreate}
          googleConnected={googleStatus.data?.connected === true}
          onOpen={(deal) => setOpenDealId(deal.id)}
          onSchedule={setQuickScheduleDeal}
          onEmail={setQuickEmailDeal}
          onAddTask={(deal) => setQuickTaskDealId(deal.id)}
        />
      )}

      {boardReady && entries.length > 0 && activeView === "tasks" && (
        <TaskQueue
          startupId={startupId}
          roundId={activeRound?.id ?? null}
          entriesById={entriesById}
          onOpenDeal={setOpenDealId}
        />
      )}

      {boardReady && entries.length > 0 && activeView === "analytics" && (
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
          {analyticsQuery.data && (
            <>
              {analyticsQuery.isFetching && (
                <p className="text-[11px] text-muted-foreground">Updating…</p>
              )}
              <PipelineAnalyticsView analytics={analyticsQuery.data} currency={currency} />
            </>
          )}
        </>
      )}

      {boardReady && activeView === "board" && entries.length > 0 && (
        <>
          <PipelineToolbar
            view={view}
            onChange={(key, value) => setView((prev) => ({ ...prev, [key]: value }))}
            visibleCount={visibleEntries.length}
            totalCount={entries.length}
            canSelect={(canUpdate || canCreate) && !isCompactBoard}
            selectionActive={selectedIds !== null}
            onToggleSelection={() =>
              setSelectedIds((current) => (current === null ? new Set() : null))
            }
          />

          {hasActiveFilter && filteredPipelineQuery.isFetching && (
            <p className="text-[11px] text-muted-foreground">Updating…</p>
          )}

          {hasActiveFilter && filteredPipelineQuery.isError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
              <p>{pipelineErrorMessage(filteredPipelineQuery.error, "Could not apply these filters.")}</p>
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => void filteredPipelineQuery.refetch()}>
                  Retry
                </Button>
              </div>
            </div>
          )}

          {selectedIds !== null && (
            <BulkActionsBar
              startupId={startupId}
              selected={selectedDeals}
              canUpdate={canUpdate}
              canCreate={canCreate}
              onSelectAll={selectAllVisible}
              onClear={() => setSelectedIds(null)}
            />
          )}
        </>
      )}

      {boardReady && entries.length > 0 && activeView === "board" && isCompactBoard && (
        <MobilePipelineBoard
          stages={visibleStages}
          currency={currency}
          entriesByStage={entriesByStage}
          signalsFor={signalsFor}
          focusReasonFor={focusReasonFor}
          ownerNameFor={ownerNameFor}
          canUpdate={canUpdate}
          emptyMessage={
            view.attentionOnly || view.mineOnly || view.search.trim() !== ""
              ? "Nothing matches here"
              : "Nothing in this stage yet"
          }
          onOpen={setOpenDealId}
          onMove={moveDeal}
          onAddTask={canCreate ? setQuickTaskDealId : undefined}
        />
      )}

      {boardReady && entries.length > 0 && activeView === "board" && !isCompactBoard && (
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
            onDragCancel={() => {
              if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
              dragFrameRef.current = null;
              pendingDragRef.current = null;
              setActiveId(null);
            }}
        >
          <div
            className={cn(
              "scrollbar-none flex touch-pan-x gap-3 overflow-x-auto scroll-smooth pb-1",
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
                  currency={currency}
                  dealIds={dealIds}
                  entriesById={entriesById}
                  signalsFor={signalsFor}
                  focusReasonFor={focusReasonFor}
                  ownerNameFor={ownerNameFor}
                  canUpdate={canUpdate}
                  weightedTotal={weightedTotal}
                  emptyMessage={
                    view.attentionOnly || view.mineOnly || view.search.trim() !== ""
                      ? "Nothing matches here"
                      : "Drop an investor here"
                  }
                  selectedIds={selectedIds}
                  onOpen={setOpenDealId}
                  onMove={moveDeal}
                  onAddTask={canCreate ? setQuickTaskDealId : undefined}
                  onToggleSelected={toggleSelected}
                />
              );
            })}
          </div>

          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
            {activeDeal && (
              <DealCardOverlay
                deal={activeDeal}
                currency={currency}
                signals={signalsFor(activeDeal.id)}
                focusReason={focusReasonFor(activeDeal.id)}
                ownerName={ownerNameFor(activeDeal.id)}
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
        focusReason={openDealId ? focusReasonFor(openDealId) : null}
        roundName={activeRound?.roundName ?? "this round"}
        rounds={roundsQuery.data?.data ?? []}
        otherLeadNames={leads
          .filter((entry) => entry.id !== openDealId)
          .map((entry) => entry.investor.fullName)}
        initialTab={openDealInitialTab}
        onOpenChange={(open) => !open && setOpenDealId(null)}
        onRemove={setPendingRemove}
      />

      <TaskDialog
        open={quickTaskDeal !== null}
        onOpenChange={(open) => !open && setQuickTaskDealId(null)}
        startupId={startupId}
        task={null}
        pipelineId={quickTaskDeal?.id ?? null}
        deals={
          quickTaskDeal ? [{ id: quickTaskDeal.id, label: quickTaskDeal.investor.fullName }] : []
        }
      />

      <ScheduleMeetingDialog
        open={quickScheduleDeal !== null}
        onOpenChange={(open) => !open && setQuickScheduleDeal(null)}
        investorName={quickScheduleDeal?.investor.fullName ?? ""}
        investorEmail={quickScheduleDeal?.investor.email ?? ""}
        isSubmitting={quickScheduleMutation.isPending}
        onSubmit={(values) => quickScheduleMutation.mutate(values)}
      />

      <ComposeEmailDialog
        open={quickEmailDeal !== null}
        onOpenChange={(open) => !open && setQuickEmailDeal(null)}
        investorName={quickEmailDeal?.investor.fullName ?? ""}
        investorEmail={quickEmailDeal?.investor.email ?? ""}
        isSubmitting={quickEmailMutation.isPending}
        onSubmit={(values) => quickEmailMutation.mutate(values)}
      />

      <PassReasonDialog
        open={pendingPass !== null}
        investorName={
          pendingPass ? (entriesById.get(pendingPass.pipelineId)?.investor.fullName ?? "") : ""
        }
        isSubmitting={moveMutation.isPending}
        onCancel={() => setPendingPass(null)}
        onConfirm={confirmPass}
      />

      <CommitDialog
        open={pendingCommit !== null}
        investorName={
          pendingCommit ? (entriesById.get(pendingCommit.pipelineId)?.investor.fullName ?? "") : ""
        }
        roundName={activeRound?.roundName ?? "this round"}
        suggestedAmount={
          pendingCommit
            ? (entriesById.get(pendingCommit.pipelineId)?.expectedAmount ?? null)
            : null
        }
        isSubmitting={moveMutation.isPending}
        onCancel={() => setPendingCommit(null)}
        onConfirm={confirmCommit}
      />

      <AddDealDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        startupId={startupId}
        roundId={activeRound?.id ?? ""}
        isSubmitting={createMutation.isPending}
        onSubmit={(values) => createMutation.mutate(values)}
      />

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title={`Remove ${pendingRemove?.investor.fullName} from the pipeline?`}
        description="The contact stays in your investor directory along with everything you've logged. Their place on this board and any completed tasks on the deal are removed."
        confirmLabel="Remove from pipeline"
        pendingLabel="Removing…"
        isPending={removeMutation.isPending}
        onConfirm={() => pendingRemove && removeMutation.mutate(pendingRemove)}
      />
    </div>
  );
}
