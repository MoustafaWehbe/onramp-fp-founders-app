import { useMemo, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import type { AuditLogEntry } from "../../../lib/audit-api";
import { formatDate, getInitials, cn } from "../../../lib/utils";
import { actionLabel, actionMeta, actionToneClass, describeAction } from "./audit-meta";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(iso);
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  }).format(date);
}

type AuditTimelineProps = {
  entries: AuditLogEntry[];
};

export function AuditTimeline({ entries }: AuditTimelineProps) {
  const groups = useMemo(() => {
    const map = new Map<string, AuditLogEntry[]>();
    for (const entry of entries) {
      const key = dayLabel(entry.createdAt);
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    return Array.from(map.entries());
  }, [entries]);

  return (
    <div className="space-y-6">
      {groups.map(([label, rows]) => (
        <div key={label}>
          <div className="mb-2 flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <ul className="space-y-1.5">
            {rows.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const meta = actionMeta(entry.action);
  const Icon = meta.icon;
  const hasDetail = entry.changes != null && entry.changes !== undefined;

  return (
    <li className="card-elevated overflow-hidden">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((current) => !current)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
          hasDetail && "cursor-pointer hover:bg-surface-hover/60",
        )}
      >
        <div
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-full",
            actionToneClass(meta.tone),
          )}
        >
          <Icon className="h-4 w-4" />
        </div>

        <div
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground"
          title={entry.user.email}
        >
          {getInitials(entry.user.name)}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            <span className="font-medium">{entry.user.name}</span>{" "}
            <span className="text-muted-foreground">{describeAction(entry.action, entry.entityType)}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{relativeTime(entry.createdAt)}</span>
            {entry.ipAddress && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {entry.ipAddress}
              </span>
            )}
          </div>
        </div>

        <Badge className={cn(actionToneClass(meta.tone), "shrink-0 border-0 capitalize")}>
          {actionLabel(entry.action)}
        </Badge>

        {hasDetail && (
          <ChevronDown
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        )}
      </button>

      {open && hasDetail && (
        <div className="border-t border-border bg-surface/50 px-4 py-3 pl-17">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Details
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
            {JSON.stringify(entry.changes, null, 2)}
          </pre>
        </div>
      )}
    </li>
  );
}
