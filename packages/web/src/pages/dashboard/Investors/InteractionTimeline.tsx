import { useMemo } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Mail,
  MessageSquare,
  Milestone,
  Phone,
  StickyNote,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { usePermissions } from "../../../hooks/usePermissions";
import {
  INTERACTION_TYPE_LABELS,
  type InteractionLog,
  type InteractionType,
} from "../../../lib/interaction-log-api";
import type { PipelineStageEvent } from "../../../lib/pipeline-api";
import { cn } from "../../../lib/utils";
import { StageBadge } from "./StageBadge";

const TYPE_ICONS: Record<InteractionType, LucideIcon> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
  other: MessageSquare,
};

const TYPE_TONES: Record<InteractionType, string> = {
  call: "bg-info/15 text-info",
  email: "bg-primary/15 text-primary",
  meeting: "bg-warning/15 text-warning",
  note: "bg-muted text-muted-foreground",
  other: "bg-muted text-muted-foreground",
};

function formatWhen(iso: string | null): string {
  if (!iso) return "No date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** The name is the part someone actually scans for — give it real weight. */
function Author({ name }: { name: string }) {
  return <span className="font-medium text-foreground">{name}</span>;
}

type ActivityItem =
  | { kind: "log"; at: number; log: InteractionLog }
  | { kind: "stage"; at: number; event: PipelineStageEvent };

type InteractionTimelineProps = {
  logs: InteractionLog[];
  /** Stage moves for this deal, oldest first — omit where there's no pipeline entry to show. */
  stageEvents?: PipelineStageEvent[];
  /** Maps createdBy/changedBy user ids to display names; falls back to "A teammate". */
  authorNames: Map<string, string>;
  /**
   * The deal this timeline is being shown against, when there is one.
   *
   * Logs belong to the investor, not the deal — the same contact can be in a
   * Seed and a Series A round at once, and a log made from the Investors page
   * carries no deal at all. Showing the whole relationship is the useful
   * thing, but presenting another round's calls as if they were this deal's
   * is not, so anything tied to a different deal is marked.
   */
  currentPipelineId?: string | null;
  isLoading: boolean;
  onEdit: (log: InteractionLog) => void;
  onDelete: (log: InteractionLog) => void;
};

export function InteractionTimeline({
  logs,
  stageEvents = [],
  authorNames,
  currentPipelineId = null,
  isLoading,
  onEdit,
  onDelete,
}: InteractionTimelineProps) {
  const { can } = usePermissions();
  const canEdit = can("pipeline", "update");
  const canDelete = can("pipeline", "delete");
  const now = Date.now();

  const items = useMemo<ActivityItem[]>(() => {
    const logItems: ActivityItem[] = logs.map((log) => ({
      kind: "log",
      at: new Date(log.interactionDate ?? log.createdAt).getTime(),
      log,
    }));
    const stageItems: ActivityItem[] = stageEvents.map((event) => ({
      kind: "stage",
      at: new Date(event.createdAt).getTime(),
      event,
    }));
    return [...logItems, ...stageItems].sort((a, b) => b.at - a.at);
  }, [logs, stageEvents]);

  if (isLoading) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">Loading history…</p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 px-6 py-8 text-center">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-surface text-muted-foreground">
          <MessageSquare className="h-4 w-4" />
        </div>
        <p className="text-sm font-medium">Nothing logged yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Record your first call, email or meeting and it will show up here.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {items.map((item) => {
        if (item.kind === "stage") {
          const { event } = item;
          const author = authorNames.get(event.changedBy ?? "") ?? "A teammate";

          return (
            <li
              key={`stage-${event.id}`}
              className="flex items-center gap-3 rounded-xl border border-dashed border-border/60 px-3.5 py-3"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface text-muted-foreground/80">
                <Milestone className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                {/* The stage badges carry the weight here — surrounding words
                    stay quiet so this reads as a lightweight system note
                    rather than competing with real interaction logs below. */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {event.fromStage === null ? (
                    <>
                      <span>Added in</span>
                      <StageBadge stageId={event.toStage} />
                    </>
                  ) : (
                    <>
                      <StageBadge stageId={event.fromStage} />
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                      <StageBadge stageId={event.toStage} />
                    </>
                  )}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground/70">
                  {formatWhen(event.createdAt)} · <Author name={author} />
                </div>
              </div>
            </li>
          );
        }

        const { log } = item;
        const Icon = TYPE_ICONS[log.type] ?? MessageSquare;
        const author = authorNames.get(log.createdBy) ?? "A teammate";
        const followupDone = log.followupCompletedAt !== null;
        // Only when it is pinned to some *other* deal — an unattached log is
        // relationship-level and belongs in every one of this investor's
        // timelines without qualification.
        const fromAnotherDeal =
          currentPipelineId !== null &&
          log.pipelineId !== null &&
          log.pipelineId !== currentPipelineId;

        return (
          <li
            key={log.id}
            className="rounded-xl border border-border/70 bg-surface/40 p-4 transition-colors hover:bg-surface/70"
          >
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                  TYPE_TONES[log.type] ?? TYPE_TONES.other,
                )}
              >
                <Icon className="h-4 w-4" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {log.subject || INTERACTION_TYPE_LABELS[log.type]}
                  </span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {INTERACTION_TYPE_LABELS[log.type]}
                  </span>
                  {fromAnotherDeal && (
                    <span
                      title="Logged against a different deal with this investor"
                      className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >
                      Another deal
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {formatWhen(log.interactionDate)} · <Author name={author} />
                </div>
              </div>

              {(canEdit || canDelete) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label={`Actions for ${log.subject || INTERACTION_TYPE_LABELS[log.type]}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-40">
                    {canEdit && (
                      <DropdownMenuItem onSelect={() => onEdit(log)}>Edit</DropdownMenuItem>
                    )}
                    {canDelete && (
                      <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(log)}>
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {log.description && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                {log.description}
              </p>
            )}

            {/* Historical only. Tasks superseded follow-ups, so nothing sets
                a new date and no outstanding one here can still be actioned —
                an alarming "Overdue since" would be asking for a response
                that has no button left to give it. */}
            {log.nextFollowupDate && (
              <div
                className={cn(
                  "mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  followupDone ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                )}
              >
                {followupDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <CalendarClock className="h-3.5 w-3.5" />
                )}
                {followupDone
                  ? `Followed up · was due ${formatWhen(log.nextFollowupDate)}`
                  : `Follow-up was set for ${formatWhen(log.nextFollowupDate)}`}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
