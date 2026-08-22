import { BarChart3, Columns3, ListChecks, Target, type LucideIcon } from "lucide-react";
import { cn } from "../../../lib/utils";

export type PipelineViewId = "board" | "focus" | "tasks" | "analytics";

const TABS: { id: PipelineViewId; label: string; icon: LucideIcon }[] = [
  { id: "board", label: "Board", icon: Columns3 },
  { id: "focus", label: "Focus", icon: Target },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];

type ViewTabsProps = {
  value: PipelineViewId;
  onChange: (value: PipelineViewId) => void;
  /** Shown on the Focus tab so the work is visible without switching to it. */
  focusCount: number;
};

export function ViewTabs({ value, onChange, focusCount }: ViewTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Pipeline view"
      className="inline-flex items-center gap-1 rounded-xl border border-border/70 bg-surface/60 p-1"
    >
      {TABS.map((tab) => {
        const active = tab.id === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-card font-medium text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
            {tab.id === "focus" && focusCount > 0 && (
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
                  active ? "bg-warning/20 text-warning" : "bg-warning/15 text-warning",
                )}
              >
                {focusCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
