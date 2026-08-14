import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Bell, CheckCheck, ClipboardCheck, Clock, Crown, Shield, Sparkles, UserPlus, Users, Wallet } from "lucide-react";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { EmptyState } from "../../../components/shared/EmptyState";
import { useNotifications } from "../../../hooks/useNotifications";
import { cn } from "../../../lib/utils";

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  team_invite: UserPlus,
  ai: Sparkles,
  reviewer: Shield,
  commitment: Wallet,
  task: Clock,
  team: Users,
  followup_due: Clock,
  task_overdue: AlertTriangle,
  task_due_today: Clock,
  task_assigned: ClipboardCheck,
  lead_stale: Crown,
  deal_no_next_step: AlertTriangle,
};

export function Notifications() {
  const { items, unreadCount, isPending, isError, markRead, markAllRead, isMarkingAll } =
    useNotifications();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Invitations and activity from every workspace you're part of."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => markAllRead()}
            disabled={unreadCount === 0 || isMarkingAll}
          >
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </Button>
        }
      />

      <div className="card-elevated overflow-hidden">
        {isPending ? (
          <ul className="divide-y divide-border/60" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="flex items-start gap-3 p-4 sm:gap-4">
                <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </li>
            ))}
          </ul>
        ) : isError ? (
          <p className="p-12 text-center text-sm text-destructive">
            We couldn't load your notifications. Please try again in a moment.
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Nothing yet"
            description="Invitations and workspace activity will show up here."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((n) => {
              const Icon = iconMap[n.type] ?? Bell;
              const isInvite = n.type === "team_invite";
              const isFollowupDue = n.type === "followup_due";

              return (
                <li
                  key={n.id}
                  className={cn(
                    "flex items-start gap-3 p-4 transition-colors hover:bg-surface-hover/50 sm:gap-4",
                    !n.read && "bg-primary/[0.03]",
                  )}
                >
                  <div
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-md",
                      isInvite || isFollowupDue
                        ? "bg-primary/15 text-primary"
                        : "bg-surface text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {n.title}
                      </span>
                      {!n.read && (
                        <button
                          type="button"
                          onClick={() => markRead(n.id)}
                          title="Mark as read"
                          aria-label={`Mark "${n.title}" as read`}
                          className="group grid h-4 w-4 shrink-0 place-items-center rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-primary transition-transform group-hover:scale-150" />
                        </button>
                      )}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground sm:hidden">
                        {n.when}
                      </span>
                    </div>
                    {n.body && (
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{n.body}</p>
                    )}
                    {isInvite && (
                      // The invitation itself is accepted from the dashboard,
                      // where the pending list lives.
                      <Link
                        to="/dashboard"
                        className="mt-1.5 inline-block text-sm text-primary hover:underline"
                      >
                        Review invitation
                      </Link>
                    )}
                    {isFollowupDue && (
                      <Link
                        to="/pipeline"
                        className="mt-1.5 inline-block text-sm text-primary hover:underline"
                      >
                        Open pipeline
                      </Link>
                    )}
                  </div>

                  <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {n.when}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
