import type { QueryClient } from "@tanstack/react-query";

/**
 * Every server-state key the fundraising workspace uses, in one place.
 *
 * Dashboard, Pipeline, Investors and Fundraising all read the same board, so
 * they must agree on both halves of a cache entry: its key *and* the shape
 * stored under it. When they drifted, two things broke — an optimistic
 * `setQueryData` written by one screen missed the copy another screen was
 * reading, and navigating between screens handed a component a cached value
 * of the wrong shape until a hard refresh replaced it.
 *
 * Rules this file exists to enforce:
 * - A key is built here, never spelled out inline.
 * - Everything under `pipeline(...)` stores `{ data: PipelineEntry[] }` — the
 *   paginated envelope, never a bare array.
 * - Round-scoped keys normalise a missing round to `null` rather than leaving
 *   `undefined` in the tuple, so the same round always serialises the same way.
 */
export const qk = {
  rounds: (startupId: string) => ["fundraising-rounds", startupId] as const,

  /**
   * `status` distinguishes the round's unfiltered fetch (used for the total
   * tiles) from the one status tile a founder clicked to filter the table —
   * see Fundraising.tsx. Both still fall under the same
   * `["commitments", startupId]` prefix for invalidation.
   */
  commitments: (startupId: string, roundId?: string | null, status?: string | null) =>
    ["commitments", startupId, roundId ?? null, status ?? null] as const,

  roundMetrics: (startupId: string, roundId?: string | null) =>
    ["round-metrics", startupId, roundId ?? null] as const,

  fundingHistory: (startupId: string, roundId?: string | null) =>
    ["funding-history", startupId, roundId ?? null] as const,

  /**
   * Stores `{ data: PipelineEntry[] }` for the whole round. `filters`
   * distinguishes the board's unfiltered fetch (used for totals) from its
   * search/attention/mine/showPassed fetch — see Pipeline.tsx — while still
   * falling under the same `["pipeline", startupId]` prefix for invalidation.
   */
  pipeline: (
    startupId: string,
    roundId?: string | null,
    filters?: {
      search?: string | null;
      ownerId?: string | null;
      attentionOnly?: boolean;
      showPassed?: boolean;
    } | null,
  ) => ["pipeline", startupId, roundId ?? null, filters ?? null] as const,

  pipelineFocus: (startupId: string, roundId?: string | null) =>
    ["pipeline-focus", startupId, roundId ?? null] as const,

  pipelineAnalytics: (startupId: string, roundId?: string | null) =>
    ["pipeline-analytics", startupId, roundId ?? null] as const,

  stageEvents: (startupId: string, pipelineId: string | null | undefined) =>
    ["pipeline-stage-events", startupId, pipelineId ?? null] as const,

  /** Every task on one deal, both open and completed. */
  tasksForDeal: (startupId: string, pipelineId: string) =>
    ["tasks", startupId, "deal", pipelineId] as const,

  /** Every task on every deal in one round, both open and completed. */
  tasksForRound: (startupId: string, roundId?: string | null) =>
    ["tasks", startupId, "round", roundId ?? null] as const,

  members: (startupId: string) => ["team-members", startupId] as const,

  roles: (startupId: string) => ["team-roles", startupId] as const,

  investors: (startupId: string, filters?: unknown) =>
    (filters === undefined
      ? (["investors", startupId] as const)
      : (["investors", startupId, filters] as const)),

  logsForInvestor: (startupId: string, investorId: string | null | undefined) =>
    ["interaction-logs", startupId, investorId ?? null] as const,

  /** One workspace-wide fetch the board derives its last-touch signals from. */
  logsForBoard: (startupId: string) => ["interaction-logs", startupId, "board"] as const,

  conversations: (startupId: string) => ["chat-conversations", startupId] as const,

  messages: (startupId: string, conversationId: string | null | undefined) =>
    ["chat-messages", startupId, conversationId ?? null] as const,

  /** A thread's parent + replies — opened from the reply count on a top-level message. */
  replies: (startupId: string, messageId: string | null | undefined) =>
    ["chat-replies", startupId, messageId ?? null] as const,

  mentionables: (startupId: string, q: string, types?: string[]) =>
    ["chat-mentionables", startupId, q, types ?? null] as const,

  /** Batch-resolved chip data for one message list — refDigest is the sorted, deduped "type:id" list. */
  resolveMentions: (startupId: string, refDigest: string) =>
    ["chat-resolve-mentions", startupId, refDigest] as const,

  /** The Discussion tab's backlink — every message referencing one entity. */
  mentionBacklink: (startupId: string, targetType: string, targetId: string | null | undefined) =>
    ["chat-mention-backlink", startupId, targetType, targetId ?? null] as const,
};

/** Prefixes — anything scoped to a startup, regardless of round or deal. */
const prefix = {
  pipeline: (startupId: string) => ["pipeline", startupId] as const,
  pipelineFocus: (startupId: string) => ["pipeline-focus", startupId] as const,
  pipelineAnalytics: (startupId: string) => ["pipeline-analytics", startupId] as const,
  stageEvents: (startupId: string) => ["pipeline-stage-events", startupId] as const,
  tasks: (startupId: string) => ["tasks", startupId] as const,
  investors: (startupId: string) => ["investors", startupId] as const,
  logs: (startupId: string) => ["interaction-logs", startupId] as const,
  commitments: (startupId: string) => ["commitments", startupId] as const,
  rounds: (startupId: string) => ["fundraising-rounds", startupId] as const,
  roundMetrics: (startupId: string) => ["round-metrics", startupId] as const,
  fundingHistory: (startupId: string) => ["funding-history", startupId] as const,
};

function invalidateAll(queryClient: QueryClient, keys: readonly (readonly unknown[])[]): void {
  for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
}

/**
 * After anything that changes a deal — stage, owner, lead, amount, removal.
 * The focus list and analytics are both derived from the board, and the
 * Investors directory embeds each contact's pipeline entry, so none of them
 * can be left behind.
 */
export function invalidateDealData(queryClient: QueryClient, startupId: string): void {
  invalidateAll(queryClient, [
    prefix.pipeline(startupId),
    prefix.pipelineFocus(startupId),
    prefix.pipelineAnalytics(startupId),
    prefix.investors(startupId),
  ]);
}

/**
 * After creating, editing, completing or deleting a task. Focus is recomputed
 * server-side from open tasks, so it always travels with a task write.
 */
export function invalidateTaskData(queryClient: QueryClient, startupId: string): void {
  invalidateAll(queryClient, [prefix.tasks(startupId), prefix.pipelineFocus(startupId)]);
}

/** After logging, editing or removing an interaction. */
export function invalidateInteractionData(queryClient: QueryClient, startupId: string): void {
  invalidateAll(queryClient, [
    prefix.logs(startupId),
    prefix.investors(startupId),
    prefix.pipelineFocus(startupId),
  ]);
}

/** After a commitment is written, which also moves the deal behind it. */
export function invalidateFinancialData(queryClient: QueryClient, startupId: string): void {
  invalidateAll(queryClient, [
    prefix.rounds(startupId),
    prefix.commitments(startupId),
    prefix.roundMetrics(startupId),
    prefix.fundingHistory(startupId),
  ]);
  invalidateDealData(queryClient, startupId);
}

/** After a stage move, which records history alongside the deal change. */
export function invalidateStageData(queryClient: QueryClient, startupId: string): void {
  invalidateDealData(queryClient, startupId);
  invalidateAll(queryClient, [prefix.stageEvents(startupId)]);
}
