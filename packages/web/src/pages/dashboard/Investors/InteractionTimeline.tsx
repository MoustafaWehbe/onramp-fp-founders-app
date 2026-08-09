import {
  CalendarClock,
  CheckCircle2,
  Mail,
  MessageSquare,
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
import { cn } from "../../../lib/utils";

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

type InteractionTimelineProps = {
  logs: InteractionLog[];
  /** Maps createdBy user ids to display names; falls back to "A teammate". */
  authorNames: Map<string, string>;
  isLoading: boolean;
  onEdit: (log: InteractionLog) => void;
  onDelete: (log: InteractionLog) => void;
};

export function InteractionTimeline({
  logs,
  authorNames,
  isLoading,
  onEdit,
  onDelete,
}: InteractionTimelineProps) {
  const { can } = usePermissions();
  const canEdit = can("pipeline", "update");
  const canDelete = can("pipeline", "delete");
  const now = Date.now();

  if (isLoading) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">Loading history…</p>
    );
  }

  if (logs.length === 0) {
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
    <ol className="relative space-y-4 pl-6">
      {/* Spine, tucked behind the markers. */}
      <span aria-hidden className="absolute bottom-2 left-[11px] top-2 w-px bg-border/70" />

      {logs.map((log) => {
        const Icon = TYPE_ICONS[log.type] ?? MessageSquare;
        const author = authorNames.get(log.createdBy) ?? "A teammate";
        const followupDone = log.followupCompletedAt !== null;
        const followupUpcoming =
          log.nextFollowupDate !== null && new Date(log.nextFollowupDate).getTime() > now;

        return (
          <li key={log.id} className="relative">
            <span
              className={cn(
                "absolute -left-6 grid h-6 w-6 place-items-center rounded-full ring-4 ring-card",
                TYPE_TONES[log.type] ?? TYPE_TONES.other,
              )}
            >
              <Icon className="h-3 w-3" />
            </span>

            <div className="rounded-xl border border-border/70 bg-surface/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {log.subject || INTERACTION_TYPE_LABELS[log.type]}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {INTERACTION_TYPE_LABELS[log.type]}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {formatWhen(log.interactionDate)} · {author}
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
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => onDelete(log)}
                        >
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {log.description && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {log.description}
                </p>
              )}

              {log.nextFollowupDate && (
                <div
                  className={cn(
                    "mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
                    followupDone
                      ? "bg-success/15 text-success"
                      : followupUpcoming
                        ? "bg-warning/15 text-warning"
                        : "bg-destructive/15 text-destructive",
                  )}
                >
                  {followupDone ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <CalendarClock className="h-3.5 w-3.5" />
                  )}
                  {followupDone
                    ? `Followed up · was due ${formatWhen(log.nextFollowupDate)}`
                    : `${followupUpcoming ? "Follow up" : "Overdue since"} ${formatWhen(log.nextFollowupDate)}`}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
