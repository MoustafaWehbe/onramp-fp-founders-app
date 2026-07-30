import { NavLink, useLocation } from "react-router-dom";
import {
  Bell,
  Briefcase,
  Building2,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Plus,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  UserCog,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { cn } from "../../lib/utils";
import { useUnreadNotificationCount } from "../../lib/app-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";

const navGroups = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Fundraising",
    items: [
      { to: "/investors", label: "Investors", icon: Users },
      { to: "/pipeline", label: "Pipeline", icon: Briefcase },
      { to: "/fundraising", label: "Rounds", icon: Wallet },
    ],
  },
  {
    label: "Data Room",
    items: [
      { to: "/documents", label: "Documents", icon: FileText },
      { to: "/reviewers", label: "Reviewers", icon: Shield },
    ],
  },
  {
    label: "AI",
    items: [
      { to: "/ai/analysis", label: "AI Analysis", icon: Sparkles },
      { to: "/ai/chat", label: "AI Chat", icon: MessageSquare },
    ],
  },
  {
    label: "Workspace",
    items: [
      { to: "/team", label: "Team & Roles", icon: UserCog },
      { to: "/startup", label: "Startup", icon: Building2 },
      { to: "/audit", label: "Audit Log", icon: ScrollText },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

type SidebarProps = {
  className?: string;
  onNavigate?: () => void;
  onClose?: () => void;
};

export function Sidebar({ className, onNavigate, onClose }: SidebarProps) {
  const location = useLocation();
  const unreadCount = useUnreadNotificationCount();

  return (
    <aside
      className={cn(
        "w-64 shrink-0 flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-border/60 px-5">
        <div className="grid h-7 w-7 place-items-center rounded bg-primary font-display text-sm font-bold text-primary-foreground">
          R
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-semibold tracking-tight">Raise</div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            AI Fundraising
          </div>
        </div>
        {onClose && (
          <Button type="button" variant="ghost" size="icon" aria-label="Close navigation" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="px-3 py-3">
        <StartupSwitcher />
      </div>

      <nav className="scrollbar-slim min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="mb-1 px-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
                const Icon = item.icon;
                const badge =
                  item.to === "/notifications" && unreadCount > 0
                    ? unreadCount > 9
                      ? "9+"
                      : String(unreadCount)
                    : null;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-primary"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                      )}
                    >
                      <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                      <span className="flex-1">{item.label}</span>
                      {badge && (
                        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">
                          {badge}
                        </span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border/60 p-3">
        <UserMenu />
      </div>
    </aside>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();

  const displayName = user
    ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email
    : "Guest";
  const initials = (displayName || "GU")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="group flex w-full items-center gap-2.5 rounded-lg border border-border/70 bg-surface/80 px-2.5 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-ring">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/15 font-display text-xs font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{displayName}</div>
            {user?.email && (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</div>
            )}
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
      >
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <NavLink to="/settings">
            <Settings className="mr-2 h-4 w-4" /> Settings
          </NavLink>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StartupSwitcher() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="group flex w-full items-center gap-2.5 rounded-lg border border-border/70 bg-surface/80 px-2.5 py-2.5 text-left text-sm transition-colors hover:border-primary/30 hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-ring">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary font-display text-xs font-bold text-primary-foreground">
            LN
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-foreground">Lumen AI</div>
            <div className="truncate text-xs text-muted-foreground">Seed · $2.5M target</div>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
      >
        <DropdownMenuLabel>Startups</DropdownMenuLabel>
        <DropdownMenuItem>Lumen AI</DropdownMenuItem>
        <DropdownMenuItem>Northwind Labs</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Plus className="mr-2 h-4 w-4" /> New startup
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
