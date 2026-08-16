import { useState, type ComponentType } from "react";
import { AlertTriangle, Bell, CheckCheck, ClipboardCheck, Clock, Crown, Eye, LogOut, Menu, MessageSquare, Plus, Search, Shield, Sparkles, Users, Wallet } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useNotifications, type NotificationRow } from "../../hooks/useNotifications";
import { notificationHref } from "../../lib/notification-routes";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

type HeaderProps = {
  onMenuClick?: () => void;
};

export function Header({ onMenuClick }: HeaderProps) {
  const { logout } = useAuth();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border/60 bg-background/80 px-4 backdrop-blur sm:gap-3 sm:px-6 lg:px-8">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open navigation"
        className="shrink-0 lg:hidden"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="relative hidden max-w-md flex-1 md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search investors, documents, notes…"
            className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline-block">
            ⌘K
          </kbd>
        </div>

        <Button type="button" variant="ghost" size="icon" aria-label="Search" className="md:hidden">
          <Search className="h-4 w-4" />
        </Button>

        <NotificationsMenu />

        <Button type="button" size="icon" aria-label="New" className="sm:hidden">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={logout} aria-label="Log out">
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">Log out</span>
      </Button>
    </header>
  );
}

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
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
  chat_mention: MessageSquare,
  direct_message: MessageSquare,
  reviewer_opened: Eye,
};

function NotificationsMenu() {
  const { items, unreadCount, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const recent = items.slice(0, 5);

  function handleRowClick(n: NotificationRow) {
    if (!n.read) markRead(n.id);
    const href = notificationHref(n);
    setOpen(false);
    if (href) navigate(href);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] font-medium leading-none text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="overflow-hidden rounded-lg">
          <div className="flex items-center justify-between px-3 py-2.5">
            <span className="font-display text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead()}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <DropdownMenuSeparator className="m-0" />

          {recent.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              You're all caught up
            </div>
          ) : (
            <div className="scrollbar-slim max-h-80 overflow-y-auto">
              {recent.map((n) => {
                const Icon = iconMap[n.type] ?? Bell;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleRowClick(n)}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover/60",
                      !n.read && "bg-primary/[0.03]",
                    )}
                  >
                    <div
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-md",
                        n.read ? "bg-surface text-muted-foreground" : "bg-primary/15 text-primary",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{n.title}</div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                      <div className="mt-1 text-[11px] text-muted-foreground">{n.when}</div>
                    </div>
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
                        className="group mt-1.5 grid h-4 w-4 shrink-0 place-items-center rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-primary transition-transform group-hover:scale-150" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <DropdownMenuSeparator className="m-0" />
          <DropdownMenuItem asChild className="justify-center rounded-none py-2.5 text-sm font-medium text-primary">
            <Link to="/notifications">View all notifications</Link>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
