import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, CheckCircle2, Pencil, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
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
import { PRIORITY_LABELS, setTaskStatus, type Task } from "../../../lib/task-api";
import { cn } from "../../../lib/utils";
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
 * unless you already knew where to look — and what was overdue across the
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Task view"
          className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-surface/60 p-1"
        >
          {VIEWS.map((id) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                view === id
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                // Overdue is the one count worth colouring even when unselected.
                id === "overdue" && buckets.overdue.length > 0 && view !== id && "text-destructive",
              )}
            >
              {VIEW_LABELS[id]}
              <span className="font-mono text-[11px] tabular-nums opacity-75">
                {buckets[id].length}
              </span>
            </button>
          ))}
        </div>

        {canCreate && dealOptions.length > 0 && (
          <Button type="button" size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> New task
          </Button>
        )}
      </div>

      {tasksQuery.isPending && (
        <ul className="space-y-2" aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 rounded-xl border border-border/70 bg-surface/50 p-3">
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

      {!tasksQuery.isPending && tasks.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/70">
          <EmptyState
            icon={CheckCircle2}
            tone="success"
            title={EMPTY_MESSAGES[view].title}
            description={EMPTY_MESSAGES[view].detail}
          />
        </div>
      )}

      {tasks.length > 0 && (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const deal = entriesById.get(task.pipelineId);
            const due = dueLabel(task.dueDate, now);
            const assignee = memberName(task.assigneeId);
            const busy = toggleMutation.isPending && toggleMutation.variables?.id === task.id;

            return (
              <li
                key={task.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-surface/50 p-3"
              >
                <div className="min-w-0 flex-1">
                  {canUpdate ? (
                    <button
                      type="button"
                      onClick={() => setEditing(task)}
                      className={cn(
                        "block max-w-full truncate text-left text-sm font-medium hover:text-primary hover:underline",
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
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {deal && (
                      <button
                        type="button"
                        onClick={() => onOpenDeal(task.pipelineId)}
                        className="truncate hover:text-foreground hover:underline"
                      >
                        {deal.investor.fullName}
                      </button>
                    )}
                    <span>· {PRIORITY_LABELS[task.priority]}</span>
                    <span>· {assignee ?? "Unassigned"}</span>
                  </div>
                </div>

                <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs", due.tone)}>
                  <CalendarClock className="h-3.5 w-3.5" />
                  {due.text}
                </span>

                {canUpdate && (
                  <>
                    <button
                      type="button"
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
                        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
                        task.status === "completed"
                          ? "border-border bg-card text-muted-foreground hover:text-foreground focus-visible:ring-ring"
                          : "border-success/30 bg-success/[0.06] text-success hover:border-success/50 hover:bg-success/15 focus-visible:ring-success/40",
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
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
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
