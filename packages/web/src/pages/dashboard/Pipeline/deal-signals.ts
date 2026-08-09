import type { InteractionLog, InteractionType } from "../../../lib/interaction-log-api";
import type { PipelineStageId } from "../../../lib/mock-data";
import type { PipelineEntry } from "../../../lib/pipeline-api";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A live deal nobody has touched in this long is treated as drifting. */
export const QUIET_AFTER_DAYS = 14;

/** Stages with nothing left to chase — they never raise a nudge. */
export const SETTLED_STAGES = new Set<PipelineStageId>(["committed", "passed"]);

export type FollowupState = "overdue" | "today" | "upcoming" | "none";

export type DealSignals = {
  /** When this investor was last spoken to, from their newest interaction log. */
  lastTouch: string | null;
  lastTouchType: InteractionType | null;
  /** The soonest still-open follow-up. Completed ones never surface. */
  nextFollowup: string | null;
  /** The log carrying that follow-up, so it can be marked done or rescheduled. */
  followupLogId: string | null;
  followup: FollowupState;
  logCount: number;
  /** Days since the last interaction, falling back to when the deal was added. */
  daysQuiet: number;
  /** Days since the deal last moved stage. */
  daysInStage: number;
  /** Live deal that is either past its follow-up date, or has gone quiet. */
  needsAttention: boolean;
};

export const EMPTY_SIGNALS: DealSignals = {
  lastTouch: null,
  lastTouchType: null,
  nextFollowup: null,
  followupLogId: null,
  followup: "none",
  logCount: 0,
  daysQuiet: 0,
  daysInStage: 0,
  needsAttention: false,
};

export function groupLogsByInvestor(logs: InteractionLog[]): Map<string, InteractionLog[]> {
  const byInvestor = new Map<string, InteractionLog[]>();
  for (const log of logs) {
    const bucket = byInvestor.get(log.investorId);
    if (bucket) bucket.push(log);
    else byInvestor.set(log.investorId, [log]);
  }
  return byInvestor;
}

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** A follow-up counts only while it has a date and has not been completed. */
export function isFollowupOpen(log: InteractionLog): boolean {
  return log.nextFollowupDate !== null && log.followupCompletedAt === null;
}

function classifyFollowup(due: number | null, now: number): FollowupState {
  if (due === null) return "none";
  if (due < now) return "overdue";
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return due <= endOfToday.getTime() ? "today" : "upcoming";
}

export function dealSignals(
  entry: PipelineEntry,
  logs: InteractionLog[] | undefined,
  now = Date.now(),
): DealSignals {
  const list = logs ?? [];

  let lastTouch: number | null = null;
  let lastTouchType: InteractionType | null = null;
  let nextFollowup: number | null = null;
  let followupLogId: string | null = null;

  for (const log of list) {
    const at = timeOf(log.interactionDate) ?? timeOf(log.createdAt);
    if (at !== null && (lastTouch === null || at > lastTouch)) {
      lastTouch = at;
      lastTouchType = log.type;
    }

    if (!isFollowupOpen(log)) continue;
    const due = timeOf(log.nextFollowupDate);
    // Earliest open follow-up wins whether it is past or future: if several
    // have slipped, the oldest debt is the one to show.
    if (due !== null && (nextFollowup === null || due < nextFollowup)) {
      nextFollowup = due;
      followupLogId = log.id;
    }
  }

  const since = lastTouch ?? timeOf(entry.createdAt) ?? now;
  const daysQuiet = Math.max(0, Math.floor((now - since) / DAY_MS));
  const stageSince = timeOf(entry.stageChangedAt) ?? timeOf(entry.createdAt) ?? now;
  const daysInStage = Math.max(0, Math.floor((now - stageSince) / DAY_MS));
  const followup = classifyFollowup(nextFollowup, now);
  const settled = SETTLED_STAGES.has(entry.stage);

  return {
    lastTouch: lastTouch === null ? null : new Date(lastTouch).toISOString(),
    lastTouchType,
    nextFollowup: nextFollowup === null ? null : new Date(nextFollowup).toISOString(),
    followupLogId,
    followup,
    logCount: list.length,
    daysQuiet,
    daysInStage,
    needsAttention:
      !settled &&
      (followup === "overdue" ||
        followup === "today" ||
        (followup === "none" && daysQuiet >= QUIET_AFTER_DAYS)),
  };
}

/** Why a deal is flagged, for the focus list. Null when it is not flagged. */
export function attentionReason(signals: DealSignals): string | null {
  if (!signals.needsAttention) return null;
  switch (signals.followup) {
    case "overdue":
      return "Follow-up overdue";
    case "today":
      return "Follow-up due today";
    default:
      return `No next step, quiet ${formatDaysAgo(signals.daysQuiet)}`;
  }
}

/** Short chip copy for a deal's follow-up date, or null when none is open. */
export function followupLabel(signals: DealSignals, now = Date.now()): string | null {
  if (signals.nextFollowup === null) return null;
  const due = new Date(signals.nextFollowup).getTime();
  const days = Math.round((due - now) / DAY_MS);

  switch (signals.followup) {
    case "overdue":
      return days <= -1 ? `Overdue ${Math.abs(days)}d` : "Overdue";
    case "today":
      return "Due today";
    default:
      return days <= 1 ? "Due tomorrow" : `Due in ${days}d`;
  }
}

export function formatDaysAgo(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function formatDuration(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${Math.round(days / 365)} y`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
