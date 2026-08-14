import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, CalendarClock, Check, CheckCircle2, Crown,
  Target, UserRoundCheck, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "../../components/ui/button";
import { Progress } from "../../components/ui/progress";
import { LoadingSpinner } from "../../components/shared/LoadingSpinner";
import { useAuth } from "../../hooks/useAuth";
import { usePermissions } from "../../hooks/usePermissions";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiErrorMessage } from "../../lib/api-error";
import { useAppStore } from "../../lib/app-store";
import { isBankable, listCommitments, listFundraisingRounds, type FundraisingRound } from "../../lib/fundraising-api";
import { fetchAllPages } from "../../lib/pagination";
import { STAGES } from "../../lib/mock-data";
import { getPipelineFocus, listPipelineEntries, type PipelineEntry, type PipelineFocusEntry } from "../../lib/pipeline-api";
import { listMembers } from "../../lib/team-api";
import { listTasks, setTaskStatus, type Task } from "../../lib/task-api";
import { cn, formatCompactUsd, getInitials } from "../../lib/utils";
import { NoWorkspaceHome } from "./NoWorkspaceHome";
import { FOCUS_REASON_LABELS, FOCUS_REASON_TONES } from "./Pipeline/deal-signals";

const DAY_MS = 86_400_000;
const CHART_MONTHS = 9;
const STAGE_COLORS = ["#8B949E", "#3B82F6", "#F59E0B", "#A855F7", "#EC4899", "#10B981", "#EF4444"];

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function compactMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency, notation: "compact", maximumFractionDigits: 1,
  }).format(amount);
}

function fundingSeries(commitments: Array<{ amount: number | null; status: Parameters<typeof isBankable>[0]; createdAt: string }>) {
  const now = new Date();
  const months = Array.from({ length: CHART_MONTHS }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (CHART_MONTHS - 1 - index), 1);
    return { date, key: `${date.getFullYear()}-${date.getMonth()}`, month: date.toLocaleDateString("en-US", { month: "short" }), value: 0 };
  });
  const firstMonth = months[0].date.getTime();

  for (const commitment of commitments) {
    if (!isBankable(commitment.status)) continue;
    const created = new Date(commitment.createdAt);
    const createdAt = Number.isNaN(created.getTime()) ? now : created;
    const amount = commitment.amount ?? 0;
    if (createdAt.getTime() < firstMonth) {
      for (const month of months) month.value += amount;
      continue;
    }
    const key = `${createdAt.getFullYear()}-${createdAt.getMonth()}`;
    const index = months.findIndex((month) => month.key === key);
    if (index >= 0) for (let cursor = index; cursor < months.length; cursor += 1) months[cursor].value += amount;
  }

  return months.map(({ month, value }) => ({ month, value }));
}

function taskDue(task: Task) {
  if (!task.dueDate) return { label: "No due date", tone: "text-muted-foreground", overdue: false };
  const due = new Date(task.dueDate).getTime();
  const now = Date.now();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const days = Math.round((due - now) / DAY_MS);
  if (due < now) return { label: `${Math.max(1, Math.abs(days))}d overdue`, tone: "text-destructive", overdue: true };
  if (due <= end.getTime()) return { label: "Due today", tone: "text-warning", overdue: false };
  return { label: days <= 1 ? "Due tomorrow" : `Due in ${days}d`, tone: "text-muted-foreground", overdue: false };
}

export function Dashboard() {
  const workspace = useWorkspace();
  if (workspace.isLoading) return <div className="grid min-h-[60vh] place-items-center"><LoadingSpinner /></div>;
  if (workspace.hasNoWorkspace) return <NoWorkspaceHome />;
  if (!workspace.activeStartupId) return null;
  return <TodayWorkspace startupId={workspace.activeStartupId} />;
}

function TodayWorkspace({ startupId }: { startupId: string }) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const canUpdatePipeline = can("pipeline", "update");
  const queryClient = useQueryClient();
  const preferredRoundId = useAppStore((state) => state.activeRoundIds[startupId]);
  const setActiveRoundId = useAppStore((state) => state.setActiveRoundId);
  const roundsQuery = useQuery({ queryKey: ["fundraising-rounds", startupId], queryFn: () => listFundraisingRounds(startupId) });
  const rounds = roundsQuery.data?.data ?? [];
  const activeRound = useMemo<FundraisingRound | null>(
    () => rounds.find((round) => round.id === preferredRoundId) ?? rounds.find((round) => round.status === "active") ?? rounds[0] ?? null,
    [preferredRoundId, rounds],
  );

  useEffect(() => {
    if (activeRound && activeRound.id !== preferredRoundId) setActiveRoundId(startupId, activeRound.id);
  }, [activeRound, preferredRoundId, setActiveRoundId, startupId]);

  const membersQuery = useQuery({ queryKey: ["team-members", startupId], queryFn: () => listMembers(startupId) });
  const myMemberId = useMemo(
    () => membersQuery.data?.find((member) => member.user?.id === user?.id)?.id ?? null,
    [membersQuery.data, user?.id],
  );
  const pipelineQuery = useQuery({
    queryKey: ["pipeline", startupId, activeRound?.id],
    // Keep the exact same cache shape as Pipeline.tsx. These screens share
    // this key, so storing a bare array here makes client-side navigation into
    // Pipeline crash until a refresh replaces the incompatible cached value.
    queryFn: () => fetchAllPages((page, limit) => listPipelineEntries(startupId, { page, limit, roundId: activeRound!.id })).then((data) => ({ data })),
    enabled: Boolean(activeRound),
  });
  const focusQuery = useQuery({ queryKey: ["pipeline-focus", startupId, activeRound?.id], queryFn: () => getPipelineFocus(startupId, activeRound!.id), enabled: Boolean(activeRound) });
  const tasksQuery = useQuery({ queryKey: ["tasks", startupId, "round", activeRound?.id], queryFn: () => listTasks(startupId, { roundId: activeRound!.id, status: "open", limit: 100 }), enabled: Boolean(activeRound) });
  const commitmentsQuery = useQuery({ queryKey: ["commitments", startupId, activeRound?.id], queryFn: () => listCommitments(startupId, activeRound!.id), enabled: Boolean(activeRound) });

  const entries = pipelineQuery.data?.data ?? [];
  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const myTasks = useMemo(() => (tasksQuery.data?.data ?? [])
    .filter((task) => myMemberId !== null && task.assigneeId === myMemberId)
    .sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity)), [myMemberId, tasksQuery.data]);
  const overdueCount = myTasks.filter((task) => taskDue(task).overdue).length;
  const focusItems = focusQuery.data ?? [];
  const unassigned = entries.filter((entry) => entry.stage !== "passed" && !entry.ownerId);
  const leadAlerts = focusItems.filter((entry) => entry.isLead);
  const bankable = (commitmentsQuery.data?.data ?? []).filter((item) => isBankable(item.status)).reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const target = activeRound?.targetAmount ?? 0;
  const progress = target ? Math.min(100, Math.round((bankable / target) * 100)) : 0;
  const raisedSeries = useMemo(() => fundingSeries(commitmentsQuery.data?.data ?? []), [commitmentsQuery.data]);
  const stageData = useMemo(() => STAGES.map((stage, index) => ({
    name: stage.label,
    value: entries.filter((entry) => entry.stage === stage.id).length,
    color: STAGE_COLORS[index],
  })).filter((stage) => stage.value > 0), [entries]);
  const loading = roundsQuery.isPending || (Boolean(activeRound) && (
    pipelineQuery.isPending || focusQuery.isPending || tasksQuery.isPending || commitmentsQuery.isPending || membersQuery.isPending
  ));
  const loadError = roundsQuery.error ?? pipelineQuery.error ?? focusQuery.error ?? tasksQuery.error ?? commitmentsQuery.error ?? membersQuery.error;

  const completeMutation = useMutation({
    mutationFn: (task: Task) => setTaskStatus(startupId, task.id, "completed"),
    onSuccess: () => {
      toast.success("Task completed");
      void queryClient.invalidateQueries({ queryKey: ["tasks", startupId] });
      void queryClient.invalidateQueries({ queryKey: ["pipeline-focus", startupId] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not complete the task")),
  });

  return <div className="space-y-6">
    <header className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.11] via-card to-card p-5 sm:p-7">
      <div className="absolute -right-12 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        <div><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.08] px-3 py-1 text-xs font-medium text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Today</div><h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{greeting()}, {user?.firstName?.trim() || "there"}</h1><p className="mt-2 text-sm text-muted-foreground">Start with the work most likely to move your raise forward.</p></div>
        <Button asChild variant="outline" size="sm"><Link to="/pipeline">Open pipeline <ArrowRight className="h-4 w-4" /></Link></Button>
      </div>
    </header>

    {loading && <div className="grid min-h-64 place-items-center rounded-2xl border border-border/70 bg-card"><LoadingSpinner /></div>}
    {!loading && loadError && <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/[0.06] p-6 text-center"><AlertTriangle className="mx-auto h-7 w-7 text-destructive" /><h2 className="mt-3 font-display text-lg font-semibold">Dashboard data could not load</h2><p className="mt-1 text-sm text-muted-foreground">{apiErrorMessage(loadError, "Please try refreshing the page.")}</p><Button type="button" variant="outline" className="mt-4" onClick={() => void queryClient.invalidateQueries()}>Try again</Button></div>}
    {!loading && !loadError && !activeRound && <div className="rounded-2xl border border-dashed border-border p-10 text-center"><Target className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 font-display text-lg font-semibold">Create a fundraising round first</h2><p className="mt-1 text-sm text-muted-foreground">Today uses your active round to prioritize investors and work.</p><Button asChild className="mt-4"><Link to="/fundraising">Go to rounds</Link></Button></div>}

    {!loading && !loadError && activeRound && <>
      <section aria-label="Today summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={CalendarClock} label="My open tasks" value={myTasks.length} detail={overdueCount ? `${overdueCount} overdue` : "Nothing overdue"} urgent={overdueCount > 0} />
        <SummaryCard icon={AlertTriangle} label="Need attention" value={focusItems.length} detail="Across the active pipeline" urgent={focusItems.some((item) => item.reason === "overdue")} />
        <SummaryCard icon={Users} label="Unassigned deals" value={unassigned.length} detail="Need a clear owner" urgent={unassigned.length > 0} />
        <SummaryCard icon={Crown} label="Lead alerts" value={leadAlerts.length} detail={leadAlerts.length ? "Lead investors need action" : "Leads are up to date"} />
      </section>

      <section aria-label="Fundraising charts" className="grid gap-5 lg:grid-cols-3">
        <div className="card-elevated p-4 sm:p-5 lg:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-display text-base font-semibold tracking-tight">Funding progress</h2><p className="text-xs text-muted-foreground sm:text-sm">Signed or wired commitments, cumulative over 9 months</p></div><span className="rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">{compactMoney(bankable, activeRound.currency)}</span></div>
          <div className="h-[240px]" aria-label="Funding progress chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={raisedSeries} margin={{ left: 4, right: 8, top: 8 }}>
                <defs><linearGradient id="dashboard-funding-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F97316" stopOpacity={0.42} /><stop offset="100%" stopColor="#F97316" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
                <XAxis dataKey="month" stroke="#8B949E" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis width={52} stroke="#8B949E" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => compactMoney(Number(value), activeRound.currency)} />
                <Tooltip formatter={(value) => [money(Number(value), activeRound.currency), "Raised"]} contentStyle={{ background: "#1C2128", border: "1px solid #30363D", borderRadius: 10, fontSize: 12 }} labelStyle={{ color: "#8B949E" }} />
                <Area type="monotone" dataKey="value" stroke="#F97316" strokeWidth={2.5} fill="url(#dashboard-funding-gradient)" activeDot={{ r: 5, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-elevated p-4 sm:p-5">
          <div className="mb-2"><h2 className="font-display text-base font-semibold tracking-tight">Pipeline by stage</h2><p className="text-xs text-muted-foreground sm:text-sm">Live investors in this round</p></div>
          {stageData.length === 0 ? <EmptyState title="No investors yet" detail="Add investors to see your pipeline mix." compact /> : <>
            <div className="relative h-[176px]" aria-label="Pipeline by stage chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={stageData} dataKey="value" innerRadius={48} outerRadius={74} paddingAngle={2}>{stageData.map((stage) => <Cell key={stage.name} fill={stage.color} stroke="#0D1117" strokeWidth={2} />)}</Pie><Tooltip contentStyle={{ background: "#1C2128", border: "1px solid #30363D", borderRadius: 10, fontSize: 12 }} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="text-center"><div className="font-display text-2xl font-semibold tabular-nums">{entries.length}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Investors</div></div></div></div>
            <div className="mt-2 grid gap-1.5">{stageData.map((stage) => <div key={stage.name} className="flex items-center gap-2 text-xs"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} /><span className="flex-1 text-muted-foreground">{stage.name}</span><span className="font-medium tabular-nums">{stage.value}</span></div>)}</div>
          </>}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section className="card-elevated overflow-hidden">
          <SectionHeader icon={CheckCircle2} title="My tasks" description="Your next actions, ordered by due date." action="View all tasks" to="/pipeline?view=tasks" />
          {myTasks.length === 0 ? <EmptyState title="You’re caught up" detail="No open tasks are assigned to you in this round." /> : <ul className="divide-y divide-border/70">{myTasks.slice(0, 6).map((task) => {
            const deal = entriesById.get(task.pipelineId);
            const due = taskDue(task);
            return <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{task.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{deal ? `${deal.investor.fullName}${deal.investor.ventureFirm ? ` · ${deal.investor.ventureFirm}` : ""}` : "Pipeline task"}</p></div><span className={cn("inline-flex items-center gap-1 text-xs", due.tone)}><CalendarClock className="h-3.5 w-3.5" />{due.label}</span>{canUpdatePipeline && <button type="button" role="checkbox" aria-checked="false" aria-label={`Complete task ${task.title}`} disabled={completeMutation.isPending} onClick={() => completeMutation.mutate(task)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-success/30 bg-success/[0.06] px-3 text-xs font-semibold text-success hover:bg-success/15 disabled:opacity-50"><Check className="h-3.5 w-3.5" /> Done</button>}</li>;
          })}</ul>}
        </section>

        <section className="card-elevated overflow-hidden">
          <SectionHeader icon={AlertTriangle} title="Needs attention" description="The highest-impact deals to chase next." action="Open Focus" to="/pipeline?view=focus" />
          {focusItems.length === 0 ? <EmptyState title="Pipeline is healthy" detail="Every live deal has a current next step." /> : <ul className="divide-y divide-border/70">{focusItems.slice(0, 6).map((deal) => <FocusRow key={deal.id} deal={deal} />)}</ul>}
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card-elevated overflow-hidden">
          <SectionHeader icon={UserRoundCheck} title="Pipeline hygiene" description="Ownership gaps that make follow-up easy to miss." action="Assign owners" to="/pipeline" />
          {unassigned.length === 0 ? <EmptyState title="Every live deal has an owner" detail="Your team’s responsibility is clear." compact /> : <div className="grid gap-2 p-4 sm:grid-cols-2">{unassigned.slice(0, 6).map((deal) => <InvestorMiniCard key={deal.id} deal={deal} />)}</div>}
        </section>
        <aside className="card-elevated h-fit p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Active round</p><h2 className="mt-1 font-display text-lg font-semibold">{activeRound.roundName}</h2></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/12 text-primary"><Wallet className="h-5 w-5" /></div></div><div className="mt-5 flex items-end justify-between gap-3"><span className="font-display text-2xl font-semibold tabular-nums">{money(bankable, activeRound.currency)}</span><span className="text-xs text-muted-foreground">{progress}%</span></div><Progress value={progress} className="mt-2 h-2" /><p className="mt-2 text-xs text-muted-foreground">Signed or wired toward {money(target, activeRound.currency)}</p><Button asChild variant="outline" size="sm" className="mt-5 w-full"><Link to="/fundraising">View round <ArrowRight className="h-4 w-4" /></Link></Button></aside>
      </div>
    </>}
  </div>;
}

function SummaryCard({ icon: Icon, label, value, detail, urgent }: { icon: LucideIcon; label: string; value: number; detail: string; urgent?: boolean }) {
  return <div className={cn("card-elevated p-4", urgent && "border-warning/30")}><div className="flex items-start justify-between"><div className={cn("grid h-9 w-9 place-items-center rounded-xl", urgent ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary")}><Icon className="h-4 w-4" /></div><span className="font-display text-2xl font-semibold tabular-nums">{value}</span></div><p className="mt-3 text-sm font-medium">{label}</p><p className={cn("mt-0.5 text-xs text-muted-foreground", urgent && "text-warning")}>{detail}</p></div>;
}

function SectionHeader({ icon: Icon, title, description, action, to }: { icon: LucideIcon; title: string; description: string; action: string; to: string }) {
  return <div className="flex items-center justify-between gap-4 border-b border-border/70 px-4 py-4 sm:px-5"><div className="flex min-w-0 items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div><div className="min-w-0"><h2 className="font-display text-base font-semibold">{title}</h2><p className="truncate text-xs text-muted-foreground">{description}</p></div></div><Link to={to} className="shrink-0 text-xs font-medium text-primary hover:underline">{action}</Link></div>;
}

function EmptyState({ title, detail, compact }: { title: string; detail: string; compact?: boolean }) {
  return <div className={cn("flex flex-col items-center px-5 text-center", compact ? "py-8" : "py-12")}><div className="grid h-10 w-10 place-items-center rounded-xl bg-success/12 text-success"><CheckCircle2 className="h-5 w-5" /></div><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 max-w-sm text-xs text-muted-foreground">{detail}</p></div>;
}

function FocusRow({ deal }: { deal: PipelineFocusEntry }) {
  return <li><Link to="/pipeline?view=focus" className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-hover/60 sm:px-5"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/12 text-[10px] font-semibold text-primary">{getInitials(deal.investor.fullName)}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="truncate text-sm font-medium">{deal.investor.fullName}</p>{deal.isLead && <Crown className="h-3.5 w-3.5 shrink-0 text-warning" />}</div><p className="truncate text-xs text-muted-foreground">{deal.investor.ventureFirm ?? "Independent"}{deal.expectedAmount != null ? ` · ${formatCompactUsd(deal.expectedAmount)}` : ""}</p></div><span className={cn("shrink-0 rounded-md px-2 py-1 text-[11px]", FOCUS_REASON_TONES[deal.reason])}>{FOCUS_REASON_LABELS[deal.reason]}</span></Link></li>;
}

function InvestorMiniCard({ deal }: { deal: PipelineEntry }) {
  return <Link to="/pipeline" className="flex items-center gap-3 rounded-xl border border-border/70 bg-surface/30 p-3 transition-colors hover:border-primary/30"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">{getInitials(deal.investor.fullName)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{deal.investor.fullName}</p><p className="truncate text-xs text-muted-foreground">{deal.investor.ventureFirm ?? "Independent"}</p></div><span className="text-[10px] font-medium uppercase tracking-wide text-warning">Unassigned</span></Link>;
}
