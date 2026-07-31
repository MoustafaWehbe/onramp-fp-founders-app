import { Bell, LogOut, Menu, Plus, Search } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useUnreadNotificationCount } from "../../lib/app-store";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

type HeaderProps = {
  onMenuClick?: () => void;
};

export function Header({ onMenuClick }: HeaderProps) {
  const { logout } = useAuth();
  const unreadCount = useUnreadNotificationCount();
  const { pathname } = useLocation();
  const notificationsActive = pathname === "/notifications";

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

        <Button
          variant="ghost"
          size="icon"
          asChild
          className={cn("relative", notificationsActive && "bg-accent/15 text-primary")}
        >
          <Link
            to="/notifications"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] font-medium leading-none text-primary-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Link>
        </Button>

        <Button type="button" size="sm" className="hidden sm:inline-flex">
          <Plus className="h-4 w-4" /> New
        </Button>
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
