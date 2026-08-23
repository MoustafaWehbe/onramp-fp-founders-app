import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { EmptyState } from "../../../components/shared/EmptyState";
import { useAuth } from "../../../hooks/useAuth";
import { usePermissions } from "../../../hooks/usePermissions";
import { useRoundTasks } from "../../../hooks/useRoundTasks";
import { apiErrorMessage } from "../../../lib/api-error";
import type { PipelineEntry } from "../../../lib/pipeline-api";
import { invalidateTaskData, qk } from "../../../lib/query-keys";
import { listMembers } from "../../../lib/team-api";
import { PRIORITY_LABELS, setTaskStatus, type Priority, type Task } from "../../../lib/task-api";
import { cn, getInitials } from "../../../lib/utils";
import { TaskDialog } from "./TaskDialog";

type TaskQueueProps = {
  startupId: string;
  roundId: string | null;
  /** Puts an investor name against each task; keyed by pipeline id. */
  entriesById: Map<string, PipelineEntry>;
  onOpenDeal: (pipelineId: string) => void;
};

const VIEWS = ["mine", "overdue", "today", "everyone", "completed"] as const;
type ViewId = (typeof VIEWS)[number];

const VIEW_LABELS: Record<ViewId, string> = {
  mine: "Mine",
  overdue: "Overdue",
  today: "Today",
  everyone: "Everyone",
  completed: "Completed",
};

const EMPTY_MESSAGES: Record<ViewId, { title: string; detail: string }> = {
  mine: {
    title: "Nothing assigned to you",
    detail: "Work assigned to you in this round shows up here.",
  },
  overdue: {
    title: "Nothing overdue",
    detail: "Every dated next step in this round is still ahead of its deadline.",
  },
  today: {
    title: "Nothing due today",
    detail: "No next step in this round is due before the end of the day.",
  },
  everyone: {
    title: "No open tasks in this round",
    detail: "Add a next step from a deal so nothing goes quiet.",
  },
  completed: {
    title: "Nothing finished yet",
    detail: "Completed tasks in this round are kept here as a record of what was done.",
  },
};

const PRIORITY_PILL: Record<Priority, string> = {
  low: "border-border/70 bg-muted text-muted-foreground",
  medium: "border-primary/25 bg-primary/10 text-primary",
  high: "border-destructive/30 bg-destructive/10 text-destructive",
};

function isOverdue(task: Task, now: number): boolean {
  return task.dueDate !== null && new Date(task.dueDate).getTime() < now;
}

function isDueToday(task: Task, now: number): boolean {
  if (!task.dueDate) return false;
  const due = new Date(task.dueDate).getTime();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return due >= now && due <= endOfToday.getTime();
}

function dueLabel(dueDate: string | null, now: number): { text: string; tone: string } {
  if (!dueDate) return { text: "No due date", tone: "text-muted-foreground" };
  const due = new Date(dueDate).getTime();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const days = Math.round((due - now) / (24 * 60 * 60 * 1000));

  if (due < now) return { text: `Overdue ${Math.abs(days)}d`, tone: "text-destructive" };
  if (due <= endOfToday.getTime()) return { text: "Due today", tone: "text-warning" };
  if (days === 1) return { text: "Due tomorrow", tone: "text-muted-foreground" };
  return { text: `Due in ${days}d`, tone: "text-muted-foreground" };
}

/**
 * Every task across the round in one list. Tasks were only reachable by
 * opening the one deal that owned them, so work assigned to you was invisible
 * unless you already knew where to look and what was overdue across the
 * whole raise could not be answered at all.
 */
export function TaskQueue({ startupId, roundId, entriesById, onOpenDeal }: TaskQueueProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canCreate = can("pipeline", "create");
  const canUpdate = can("pipeline", "update");
  const [view, setView] = useState<ViewId>("mine");
  const [editing, setEditing] = useState<Task | "new" | null>(null);

  const membersQuery = useQuery({
    queryKey: qk.members(startupId),
    queryFn: () => listMembers(startupId),
  });

  // Tasks carry a StartupMember id, but the session knows a user id.
  const myMemberId = useMemo(
    () => membersQuery.data?.find((member) => member.user?.id === user?.id)?.id ?? null,
    [membersQuery.data, user?.id],
  );

  const memberName = (memberId: string | null) => {
    if (!memberId) return null;
    const member = membersQuery.data?.find((m) => m.id === memberId);
    if (!member) return null;
    return member.user
      ? `${member.user.firstName} ${member.user.lastName}`.trim()
      : (member.invitedEmail ?? null);
  };

  const memberAvatar = (memberId: string | null) => {
    if (!memberId) return null;
    return membersQuery.data?.find((m) => m.id === memberId)?.user?.avatarUrl ?? null;
  };

  const tasksQuery = useRoundTasks(startupId, roundId);

  const toggleMutation = useMutation({
    mutationFn: (task: Task) =>
      setTaskStatus(startupId, task.id, task.status === "completed" ? "open" : "completed"),
    onSuccess: (_result, task) => {
      toast.success(task.status === "completed" ? "Task reopened" : "Task completed");
      invalidateTaskData(queryClient, startupId);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update the task")),
  });

  const now = Date.now();
  const all = useMemo(() => tasksQuery.data?.data ?? [], [tasksQuery.data]);

  // Counted from the same list the tabs filter, so a badge can never disagree
  // with what opening the tab actually shows.
  const buckets = useMemo(() => {
    const open = all.filter((task) => task.status === "open");
    return {
      mine: myMemberId ? open.filter((task) => task.assigneeId === myMemberId) : [],
      overdue: open.filter((task) => isOverdue(task, now)),
      today: open.filter((task) => isDueToday(task, now)),
      everyone: open,
      completed: all.filter((task) => task.status === "completed"),
    } satisfies Record<ViewId, Task[]>;
  }, [all, myMemberId, now]);

  const tasks = buckets[view];

  // A task can be relinked to any other deal in the round from here.
  const dealOptions = useMemo(
    () =>
      [...entriesById.values()]
        .map((entry) => ({ id: entry.id, label: entry.investor.fullName }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [entriesById],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <ListChecks className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold tracking-tight">Round tasks</h2>
            <p className="text-sm text-muted-foreground">Next steps across every deal in this round.</p>
          </div>
        </div>

        {canCreate && dealOptions.length > 0 && (
          <Button type="button" size="sm" variant="outline" className="border-primary/40 text-primary" onClick={() => setEditing("new")}>
            <Plus className="h-3.5 w-3.5" /> New task
          </Button>
        )}
      </div>

      <div
        role="tablist"
        aria-label="Task view"
        className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-surface/60 p-1"
      >
        {VIEWS.map((id) => {
          const active = view === id;
          const count = buckets[id].length;
          return (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setView(id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-card font-medium text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {VIEW_LABELS[id]}
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
                  id === "overdue" && count > 0
                    ? active
                      ? "bg-destructive/15 text-destructive"
                      : "bg-destructive/10 text-destructive"
                    : active
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {tasksQuery.isPending && (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card" aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-3.5 w-16 shrink-0" />
              <Skeleton className="h-8 w-24 shrink-0 rounded-full" />
            </li>
          ))}
        </ul>
      )}

      {tasksQuery.isError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
          <p>{apiErrorMessage(tasksQuery.error, "Failed to load round tasks.")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void tasksQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {!tasksQuery.isPending && !tasksQuery.isError && tasks.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/70">
          <EmptyState
            icon={CheckCircle2}
            tone="success"
            title={EMPTY_MESSAGES[view].title}
            description={EMPTY_MESSAGES[view].detail}
          />
        </div>
      )}

      {!tasksQuery.isError && tasks.length > 0 && (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
          {tasks.map((task) => {
            const deal = entriesById.get(task.pipelineId);
            const due = dueLabel(task.dueDate, now);
            const assignee = memberName(task.assigneeId);
            const avatarUrl = memberAvatar(task.assigneeId);
            const busy = toggleMutation.isPending && toggleMutation.variables?.id === task.id;

            return (
              <li
                key={task.id}
                className="group flex flex-wrap items-center gap-3 p-4 transition-colors hover:bg-surface/40"
              >
                <div className="min-w-0 flex-1">
                  {canUpdate ? (
                    <button
                      type="button"
                      onClick={() => setEditing(task)}
                      className={cn(
                        "block max-w-full truncate text-left text-sm font-medium hover:text-primary",
                        task.status === "completed" && "text-muted-foreground line-through",
                      )}
                    >
                      {task.title}
                    </button>
                  ) : (
                    <p
                      className={cn(
                        "truncate text-sm font-medium",
                        task.status === "completed" && "text-muted-foreground line-through",
                      )}
                    >
                      {task.title}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {deal && (
                      <button
                        type="button"
                        onClick={() => onOpenDeal(task.pipelineId)}
                        className="truncate rounded-md border border-border/60 bg-surface/70 px-1.5 py-0.5 hover:border-primary/30 hover:text-foreground"
                      >
                        {deal.investor.fullName}
                      </button>
                    )}
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        PRIORITY_PILL[task.priority],
                      )}
                    >
                      {PRIORITY_LABELS[task.priority]}
                    </span>
                    <span className="inline-flex max-w-40 items-center gap-1.5 rounded-md border border-border/60 bg-surface/70 px-1.5 py-0.5">
                      {assignee ? (
                        <>
                          <Avatar className="h-4 w-4">
                            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
                            <AvatarFallback className="text-[8px] font-semibold">
                              {getInitials(assignee)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate">{assignee}</span>
                        </>
                      ) : (
                        <>
                          <UserRound className="h-3 w-3 shrink-0" />
                          <span>Unassigned</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", due.tone)}>
                  <CalendarClock className="h-3.5 w-3.5" />
                  {due.text}
                </span>

                {canUpdate && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      role="checkbox"
                      aria-checked={task.status === "completed"}
                      aria-label={
                        task.status === "completed"
                          ? `Reopen task ${task.title}`
                          : `Complete task ${task.title}`
                      }
                      disabled={busy}
                      onClick={() => toggleMutation.mutate(task)}
                      className={cn(
                        task.status === "completed"
                          ? "text-muted-foreground"
                          : "border-success/35 text-success hover:bg-success/10 hover:text-success",
                      )}
                    >
                      {task.status === "completed" ? (
                        <>
                          <RotateCcw className="h-3.5 w-3.5" /> Reopen
                        </>
                      ) : (
                        <>
                          <Check className="h-3.5 w-3.5" /> Mark done
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground"
                      onClick={() => setEditing(task)}
                      aria-label={`Edit task ${task.title}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <TaskDialog
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        startupId={startupId}
        task={editing === "new" ? null : editing}
        pipelineId={dealOptions[0]?.id ?? null}
        deals={dealOptions}
      />
    </div>
  );
}
