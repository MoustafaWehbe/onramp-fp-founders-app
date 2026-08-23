import type { ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, CheckCheck, ClipboardCheck, Clock, Crown, MessageSquare, Shield, Sparkles, UserPlus, Users, Wallet } from "lucide-react";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { EmptyState } from "../../../components/shared/EmptyState";
import { useNotifications, type NotificationRow } from "../../../hooks/useNotifications";
import { notificationHref } from "../../../lib/notification-routes";
import { cn } from "../../../lib/utils";

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  team_invite: UserPlus,
  ai: Sparkles,
  reviewer: Shield,
  reviewer_comment: MessageSquare,
  commitment: Wallet,
  task: Clock,
  team: Users,
  followup_due: Clock,
  task_overdue: AlertTriangle,
  task_due_today: Clock,
  task_assigned: ClipboardCheck,
  lead_stale: Crown,
  deal_no_next_step: AlertTriangle,
  chat_mention: MessageSquare,
  direct_message: MessageSquare,
};

export function Notifications() {
  const { items, unreadCount, isPending, isError, markRead, markAllRead, isMarkingAll } =
    useNotifications();
  const navigate = useNavigate();

  function handleRowClick(n: NotificationRow) {
    if (!n.read) markRead(n.id);
    const href = notificationHref(n);
    if (href) navigate(href);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Invitations and activity for the workspace you're in right now."
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
              const href = notificationHref(n);

              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleRowClick(n)}
                    className={cn(
                      "flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-surface-hover/50 sm:gap-4",
                      !n.read && "bg-primary/3",
                      href && "cursor-pointer",
                    )}
                  >
                    <div
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-md",
                        n.read ? "bg-surface text-muted-foreground" : "bg-primary/15 text-primary",
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
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              markRead(n.id);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.stopPropagation();
                              event.preventDefault();
                              markRead(n.id);
                            }}
                            title="Mark as read"
                            aria-label={`Mark "${n.title}" as read`}
                            className="group grid h-4 w-4 shrink-0 place-items-center rounded-full focus:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-primary transition-transform group-hover:scale-150" />
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground sm:hidden">
                          {n.when}
                        </span>
                      </div>
                      {n.body && (
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{n.body}</p>
                      )}
                    </div>

                    <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {n.when}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
