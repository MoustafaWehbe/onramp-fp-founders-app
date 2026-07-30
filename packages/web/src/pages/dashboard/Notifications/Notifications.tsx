import type { ComponentType } from "react";
import { Bell, CheckCheck, Clock, Shield, Sparkles, Users, Wallet } from "lucide-react";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { useAppStore, useUnreadNotificationCount } from "../../../lib/app-store";
import type { NotificationType } from "../../../lib/mock-data";
import { cn } from "../../../lib/utils";

const iconMap: Record<NotificationType, ComponentType<{ className?: string }>> = {
  ai: Sparkles,
  reviewer: Shield,
  commitment: Wallet,
  task: Clock,
  team: Users,
};

export function Notifications() {
  const items = useAppStore((state) => state.notifications);
  const markRead = useAppStore((state) => state.markNotificationRead);
  const markAllRead = useAppStore((state) => state.markAllNotificationsRead);
  const unreadCount = useUnreadNotificationCount();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Everything happening across your fundraising workspace."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={markAllRead}
            disabled={unreadCount === 0}
          >
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </Button>
        }
      />

      <div className="card-elevated overflow-hidden">
        <ul className="divide-y divide-border/60">
          {items.map((n) => {
            const Icon = iconMap[n.type] ?? Bell;
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
                    n.type === "ai"
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
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{n.body}</p>
                </div>

                <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                  {n.when}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
