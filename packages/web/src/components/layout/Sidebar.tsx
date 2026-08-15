import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MessageSquare,
  Plus,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  User,
  UserCog,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useWorkspace } from "../../hooks/useWorkspace";
import { CreateStartupDialog } from "../startup/CreateStartupDialog";
import { cn, getInitials } from "../../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Button } from "../ui/button";

const navGroups = [
  {
    label: "Overview",
    items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Fundraising",
    items: [
      { to: "/investors", label: "Investors", icon: Users },
      { to: "/pipeline", label: "Pipeline", icon: Briefcase },
      { to: "/fundraising", label: "Rounds", icon: Wallet },
      { to: "/chat", label: "Chat", icon: MessageCircle },
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
        <StartupSwitcher onNavigate={onNavigate} />
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
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border/60 p-3">
        <UserMenu onNavigate={onNavigate} />
      </div>
    </aside>
  );
}

function UserMenu({ onNavigate }: { onNavigate?: () => void }) {
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
        <button className="group flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card/95 px-3 py-2.5 text-left shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_8px_20px_-14px_rgba(0,0,0,0.7)] transition-colors duration-200 hover:border-primary/40 hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-ring data-[state=open]:border-primary/40 data-[state=open]:bg-surface-hover">
          <Avatar className="h-9 w-9 shrink-0 ring-1 ring-primary/15">
            <AvatarImage src={user?.avatarUrl ?? undefined} alt={displayName} className="object-cover" />
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
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
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
          {/* Closes the mobile drawer too — otherwise it stays open over Settings. */}
          <NavLink to="/profile" onClick={onNavigate}>
            <User className="mr-2 h-4 w-4" /> Profile
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

const FUNDING_STAGE_LABELS: Record<string, string> = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
  series_b: "Series B",
  series_c: "Series C",
};

function StartupSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { startups, activeStartup, setActiveStartupId } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  if (!activeStartup) return null;

  const subtitle = [
    FUNDING_STAGE_LABELS[activeStartup.fundingStage] ?? activeStartup.fundingStage,
    activeStartup.industry,
  ]
    .filter(Boolean)
    .join(" · ");

  function switchTo(startupId: string) {
    if (startupId === activeStartup?.id) return;
    setActiveStartupId(startupId);
    // Every cached list is keyed by startup id, so the new workspace's queries
    // simply miss the cache — but drop the old ones so a switch back is fresh.
    void queryClient.invalidateQueries();
    onNavigate?.();
    navigate("/dashboard");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="group flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card/95 px-3 py-2.5 text-left text-sm shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_8px_20px_-14px_rgba(0,0,0,0.7)] transition-colors duration-200 hover:border-primary/40 hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-ring data-[state=open]:border-primary/40 data-[state=open]:bg-surface-hover">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary font-display text-xs font-bold text-primary-foreground">
            {getInitials(activeStartup.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-foreground">{activeStartup.name}</div>
            {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
      >
        <DropdownMenuLabel>Startups</DropdownMenuLabel>
        {startups.map((startup) => (
          <DropdownMenuItem key={startup.id} onSelect={() => switchTo(startup.id)}>
            <div className="min-w-0 flex-1">
              <div className="truncate">{startup.name}</div>
              <div className="truncate text-xs capitalize text-muted-foreground">
                {startup.member.role}
              </div>
            </div>
            {startup.id === activeStartup.id && (
              <Check className="ml-2 h-4 w-4 shrink-0 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New startup
        </DropdownMenuItem>
      </DropdownMenuContent>

      <CreateStartupDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          // The dialog switches into the new workspace itself; closing it is
          // the moment the mobile nav has finished its job.
          if (!open) onNavigate?.();
        }}
      />
    </DropdownMenu>
  );
}
