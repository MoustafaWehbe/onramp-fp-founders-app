import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** "success" reads as an all-clear (nothing left to do); "neutral" reads as data simply not existing yet. */
  tone?: "neutral" | "success";
  action?: ReactNode;
  compact?: boolean;
  className?: string;
};

/**
 * One empty-state layout for every "nothing here" moment in the workspace —
 * icon, title, short detail, optional action — so founders learn its shape
 * once instead of re-reading a differently laid out message on every page.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  tone = "neutral",
  action,
  compact,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
    >
      <div
        className={cn(
          "grid h-10 w-10 place-items-center rounded-xl",
          tone === "success" ? "bg-success/12 text-success" : "border border-border bg-surface text-muted-foreground",
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <p className="font-display text-base font-semibold">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
