import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useWorkspace } from "../../hooks/useWorkspace";
import { LoadingSpinner } from "../../components/shared/LoadingSpinner";
import { NoWorkspaceHome } from "./NoWorkspaceHome";
import { CreateStartupDialog } from "../../components/startup/CreateStartupDialog";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Progress } from "../../components/ui/progress";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  ArrowUpRight,
  Bell,
  ChevronDown,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

const startupStageOptions = [
  "Pre-seed",
  "Seed",
  "Series A",
  "Growth",
  "Other",
] as const;

const raisedSeries = [
  { month: "Jan", value: 120 },
  { month: "Feb", value: 210 },
  { month: "Mar", value: 340 },
  { month: "Apr", value: 460 },
  { month: "May", value: 640 },
  { month: "Jun", value: 780 },
  { month: "Jul", value: 1020 },
  { month: "Aug", value: 1240 },
  { month: "Sep", value: 1450 },
];

const stageData = [
  { name: "Pre-seed", value: 3 },
  { name: "Seed", value: 8 },
  { name: "Series A", value: 5 },
  { name: "Growth", value: 2 },
];

const stageColors = ["#8B949E", "#3B82F6", "#A78BFA", "#F97316"];

export function Dashboard() {
  const { isLoading: isWorkspaceLoading, hasNoWorkspace } = useWorkspace();

  if (isWorkspaceLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <LoadingSpinner />
      </div>
    );
  }

  // Nothing below this point means anything without a workspace — every panel
  // is scoped to one.
  if (hasNoWorkspace) {
    return <NoWorkspaceHome />;
  }

  return <WorkspaceDashboard />;
}

function WorkspaceDashboard() {
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="card-elevated relative overflow-hidden p-4 sm:p-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.16),transparent_48%)]" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Founder workspace
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Good morning, {user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email : "there"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              Here&apos;s what&apos;s moving on your startup today.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm">
              <Plus className="h-4 w-4" />
              Add investor
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="card-elevated group relative overflow-hidden p-5 transition-transform duration-200 hover:-translate-y-0.5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
          <div className="flex items-start justify-between">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Wallet className="h-4 w-4" />
            </div>
            <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
              +$150k this week
            </span>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">Raised</div>
          <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums tracking-tight">$240k</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">of your $2.5M target</div>
          <Progress value={48} className="mt-3 h-1.5" />
        </div>

        <div className="card-elevated group relative overflow-hidden p-5 transition-transform duration-200 hover:-translate-y-0.5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
          <div className="flex items-start justify-between">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Users className="h-4 w-4" />
            </div>
            <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
              +2 vs last week
            </span>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">Active investors</div>
          <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums tracking-tight">18</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">8 in active conversations</div>
        </div>

        <div className="card-elevated group relative overflow-hidden p-5 transition-transform duration-200 hover:-translate-y-0.5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
          <div className="flex items-start justify-between">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <TrendingUp className="h-4 w-4" />
            </div>
            <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
              +18% MoM
            </span>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">Weighted pipeline</div>
          <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums tracking-tight">$860k</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">Probability-adjusted</div>
        </div>

        <div className="card-elevated group relative overflow-hidden p-5 transition-transform duration-200 hover:-translate-y-0.5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
          <div className="flex items-start justify-between">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
              +6 vs v3
            </span>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">AI readiness</div>
          <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums tracking-tight">82</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">Pitch deck v4</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-elevated p-4 sm:p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-display text-base font-semibold tracking-tight">Funding progress</div>
              <div className="text-xs text-muted-foreground sm:text-sm">Cumulative raised, last 9 months</div>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="More options">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={raisedSeries}>
                <defs>
                  <linearGradient id="brand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F97316" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#F97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
                <XAxis dataKey="month" stroke="#8B949E" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#8B949E" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}k`} />
                <Tooltip
                  contentStyle={{ background: "#1C2128", border: "1px solid #30363D", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#8B949E" }}
                />
                <Area type="monotone" dataKey="value" stroke="#F97316" strokeWidth={2} fill="url(#brand)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-elevated p-4 sm:p-5">
          <div className="mb-4">
            <div className="font-display text-base font-semibold tracking-tight">Pipeline by stage</div>
            <div className="text-xs text-muted-foreground sm:text-sm">Investor pipeline overview</div>
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stageData} dataKey="value" innerRadius={50} outerRadius={78} paddingAngle={2}>
                  {stageData.map((_, index) => (
                    <Cell key={index} fill={stageColors[index]} stroke="#0D1117" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#1C2128", border: "1px solid #30363D", borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 space-y-1.5">
            {stageData.map((stage, index) => (
              <div key={stage.name} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: stageColors[index] }} />
                <span className="flex-1 text-muted-foreground">{stage.name}</span>
                <span className="font-medium">{stage.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-elevated lg:col-span-2">
          <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
            <div>
              <div className="font-display text-base font-semibold tracking-tight">Top open investors</div>
              <div className="text-xs text-muted-foreground sm:text-sm">Sorted by weighted amount</div>
            </div>
            <Button type="button" variant="ghost" size="sm">
              View pipeline <ArrowUpRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="divide-y divide-border">
            {[
              { name: "Ava Chen", firm: "Northstar Ventures", stage: "Seed" },
              { name: "Marcus Lee", firm: "Harbor Capital", stage: "Pre-seed" },
              { name: "Nina Patel", firm: "Lattice Partners", stage: "Series A" },
            ].map((investor) => (
              <div key={investor.name} className="flex items-center justify-between p-4 transition-colors hover:bg-surface-hover/70">
                <div>
                  <p className="text-sm font-medium">{investor.name}</p>
                  <p className="text-xs text-muted-foreground">{investor.firm}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="border-primary/20 bg-primary/10 text-primary">{investor.stage}</Badge>
                  <Button type="button" variant="ghost" size="icon" aria-label="Open investor">
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card-elevated">
          <div className="flex items-center justify-between border-b border-border p-4 sm:p-5">
            <div className="font-display text-base font-semibold tracking-tight">Recent activity</div>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="divide-y divide-border">
            {[
              { label: "Investor update shared", detail: "5 min ago" },
              { label: "New document uploaded", detail: "1 hour ago" },
              { label: "AI analysis requested", detail: "Today" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2 p-4">
                <Bell className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="card-elevated group flex items-center gap-3 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-surface-hover"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">Create startup</div>
            <div className="text-xs text-muted-foreground">Start another workspace</div>
          </div>
        </button>

        <Link
          to="/documents"
          className="card-elevated group flex items-center gap-3 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-surface-hover"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">Upload document</div>
            <div className="text-xs text-muted-foreground">Share your latest deck</div>
          </div>
        </Link>

        <Link
          to="/ai-insights"
          className="card-elevated group flex items-center gap-3 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-surface-hover"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">Ask AI about your data</div>
            <div className="text-xs text-muted-foreground">Get instant insights</div>
          </div>
        </Link>

        {/* No reviewers route exists yet, so this points at Team rather than a
            dead link. Repoint it once the reviewer invitation flow is built. */}
        <Link
          to="/team"
          className="card-elevated group flex items-center gap-3 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-surface-hover"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Users className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">Invite a reviewer</div>
            <div className="text-xs text-muted-foreground">Bring in a trusted partner</div>
          </div>
        </Link>
      </div>

      <CreateStartupDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
