import type { InteractionLog, InteractionType } from "../../../lib/interaction-log-api";
import type { FocusReason, PipelineEntry } from "../../../lib/pipeline-api";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Short chip copy for why a deal showed up in Focus server-computed, client just labels it. */
export const FOCUS_REASON_LABELS: Record<FocusReason, string> = {
  overdue: "Task overdue",
  today: "Task due today",
  missing: "No next step",
  quiet: "Gone quiet",
  priority: "High priority",
};

export const FOCUS_REASON_TONES: Record<FocusReason, string> = {
  overdue: "bg-destructive/15 text-destructive",
  today: "bg-warning/15 text-warning",
  missing: "bg-warning/15 text-warning",
  quiet: "bg-muted text-muted-foreground",
  priority: "bg-primary/15 text-primary",
};

export type DealSignals = {
  /** When this investor was last spoken to, from their newest interaction log. */
  lastTouch: string | null;
  lastTouchType: InteractionType | null;
  logCount: number;
  /** Days since the last interaction, falling back to when the deal was added. */
  daysQuiet: number;
  /** Days since the deal last moved stage. */
  daysInStage: number;
};

export const EMPTY_SIGNALS: DealSignals = {
  lastTouch: null,
  lastTouchType: null,
  logCount: 0,
  daysQuiet: 0,
  daysInStage: 0,
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

export function dealSignals(
  entry: PipelineEntry,
  logs: InteractionLog[] | undefined,
  now = Date.now(),
): DealSignals {
  const list = logs ?? [];

  let lastTouch: number | null = null;
  let lastTouchType: InteractionType | null = null;

  for (const log of list) {
    const at = timeOf(log.interactionDate) ?? timeOf(log.createdAt);
    if (at !== null && (lastTouch === null || at > lastTouch)) {
      lastTouch = at;
      lastTouchType = log.type;
    }
  }

  const since = lastTouch ?? timeOf(entry.createdAt) ?? now;
  const daysQuiet = Math.max(0, Math.floor((now - since) / DAY_MS));
  const stageSince = timeOf(entry.stageChangedAt) ?? timeOf(entry.createdAt) ?? now;
  const daysInStage = Math.max(0, Math.floor((now - stageSince) / DAY_MS));

  return {
    lastTouch: lastTouch === null ? null : new Date(lastTouch).toISOString(),
    lastTouchType,
    logCount: list.length,
    daysQuiet,
    daysInStage,
  };
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
