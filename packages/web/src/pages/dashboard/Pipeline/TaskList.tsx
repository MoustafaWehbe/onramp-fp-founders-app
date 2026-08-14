import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, CheckCircle2, ChevronDown, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "../../../components/shared/ConfirmDialog";
import { Button } from "../../../components/ui/button";
import { DateTimePicker } from "../../../components/ui/date-time-picker";
import { usePermissions } from "../../../hooks/usePermissions";
import { apiErrorMessage } from "../../../lib/api-error";
import { invalidateTaskData, qk } from "../../../lib/query-keys";
import { listMembers } from "../../../lib/team-api";
import {
  PRIORITY_LABELS,
  deleteTask,
  listTasks,
  setTaskStatus,
  updateTask,
  type Task,
} from "../../../lib/task-api";
import { cn } from "../../../lib/utils";
import { TaskDialog } from "./TaskDialog";

type TaskListProps = {
  startupId: string;
  pipelineId: string;
  /** The investor this deal is with — named on the task composer. */
  dealLabel: string;
};

function formatDueDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function dueTone(task: Task): string {
  if (task.status === "completed" || !task.dueDate) return "text-muted-foreground";
  const due = new Date(task.dueDate).getTime();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (due < Date.now()) return "text-destructive";
  if (due <= endOfToday.getTime()) return "text-warning";
  return "text-muted-foreground";
}

export function TaskList({ startupId, pipelineId, dealLabel }: TaskListProps) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canCreate = can("pipeline", "create");
  const canUpdate = can("pipeline", "update");
  const canDelete = can("pipeline", "delete");

  const [showCompleted, setShowCompleted] = useState(false);
  // null closes the dialog; "new" composes; a task edits it.
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);

  const tasksQuery = useQuery({
    queryKey: qk.tasksForDeal(startupId, pipelineId),
    queryFn: () => listTasks(startupId, { pipelineId, limit: 100 }),
  });

  const membersQuery = useQuery({
    queryKey: qk.members(startupId),
    queryFn: () => listMembers(startupId),
  });

  const memberName = (memberId: string | null) => {
    if (!memberId) return null;
    const member = membersQuery.data?.find((m) => m.id === memberId);
    if (!member) return null;
    return member.user
      ? `${member.user.firstName} ${member.user.lastName}`.trim()
      : (member.invitedEmail ?? null);
  };

  const invalidate = () => invalidateTaskData(queryClient, startupId);

  const toggleMutation = useMutation({
    mutationFn: (task: Task) =>
      setTaskStatus(startupId, task.id, task.status === "completed" ? "open" : "completed"),
    onMutate: async (task) => {
      const queryKey = qk.tasksForDeal(startupId, pipelineId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<{ data: Task[]; meta: unknown }>(queryKey);
      queryClient.setQueryData<{ data: Task[]; meta: unknown }>(queryKey, (current) =>
        current
          ? {
              ...current,
              data: current.data.map((item) =>
                item.id === task.id
                  ? { ...item, status: task.status === "completed" ? "open" : "completed" }
                  : item,
              ),
            }
          : current,
      );
      return { previous, queryKey, wasCompleted: task.status === "completed" };
    },
    onSuccess: (_result, _task, context) => {
      toast.success(context.wasCompleted ? "Task reopened" : "Task completed");
    },
    onError: (err, _task, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
      toast.error(apiErrorMessage(err, "Could not update the task"));
    },
    onSettled: invalidate,
  });

  const postponeMutation = useMutation({
    mutationFn: ({ task, date }: { task: Task; date: Date | null }) =>
      updateTask(startupId, task.id, { dueDate: date ? date.toISOString() : null }),
    onSuccess: invalidate,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not reschedule the task")),
  });

  const deleteMutation = useMutation({
    mutationFn: (task: Task) => deleteTask(startupId, task.id),
    onSuccess: () => {
      toast.success("Task removed");
      setPendingDelete(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not remove the task")),
  });

  const tasks = tasksQuery.data?.data ?? [];
  const open = tasks.filter((t) => t.status === "open");
  const completed = tasks.filter((t) => t.status === "completed");

  return (
    <section aria-label="Tasks" className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-base font-semibold">Next steps</h3>
          <p className="mt-1 text-sm text-muted-foreground">Keep this deal moving with one clear owner and due date.</p>
        </div>
        {canCreate && (
          <Button type="button" size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Add task
          </Button>
        )}
      </div>

      {tasksQuery.isPending && (
        <div className="rounded-2xl border border-border/70 bg-surface/30 px-4 py-8 text-center text-sm text-muted-foreground">Loading tasks…</div>
      )}

      {!tasksQuery.isPending && tasks.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-surface/20 px-5 py-10 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium">No open next steps</p>
          <p className="mt-1 text-xs text-muted-foreground">Add a task so this opportunity never goes quiet.</p>
        </div>
      )}

      {open.length > 0 && (
        <ul className="space-y-2">
          {open.map((task) => (
            <li
              key={task.id}
              className="group flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-3 transition-colors hover:border-primary/30 hover:bg-surface/40"
            >
              <div className="min-w-0 flex-1">
                {canUpdate ? (
                  <button
                    type="button"
                    onClick={() => setEditing(task)}
                    className="block max-w-full truncate text-left text-sm hover:text-primary hover:underline"
                  >
                    {task.title}
                  </button>
                ) : (
                  <p className="truncate text-sm">{task.title}</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="capitalize">{PRIORITY_LABELS[task.priority]}</span>
                  <span>· {memberName(task.assigneeId) ?? "Unassigned"}</span>
                </div>
              </div>

              <span className={cn("inline-flex items-center gap-1 text-xs", dueTone(task))}>
                <CalendarClock className="h-3.5 w-3.5" />
                {canUpdate ? (
                  <DateTimePicker
                    value={task.dueDate ? new Date(task.dueDate) : null}
                    onChange={(date) => postponeMutation.mutate({ task, date })}
                    placeholder="No due date"
                    className="h-7 w-auto border-none bg-transparent px-1 text-xs shadow-none"
                  />
                ) : (
                  formatDueDate(task.dueDate) || "No due date"
                )}
              </span>

              {canUpdate && (
                <>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked="false"
                    aria-label={`Complete task ${task.title}`}
                    disabled={toggleMutation.isPending && toggleMutation.variables?.id === task.id}
                    onClick={() => toggleMutation.mutate(task)}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/[0.06] px-3 text-xs font-semibold text-success transition-colors hover:border-success/50 hover:bg-success/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {toggleMutation.isPending && toggleMutation.variables?.id === task.id ? "Finishing…" : "Mark done"}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditing(task)}
                    aria-label={`Edit task ${task.title}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}

              {canDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setPendingDelete(task)}
                  aria-label={`Delete task ${task.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {completed.length > 0 && (
        <div className="space-y-2 border-t border-border/70 pt-4">
          <button type="button" className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setShowCompleted((value) => !value)}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", showCompleted && "rotate-180")} />
            Completed ({completed.length})
          </button>
          {showCompleted && <ul className="space-y-2">{completed.map((task) => (
            <li key={task.id} className="flex items-center gap-3 rounded-xl border border-border/50 bg-surface/20 px-3 py-3">
              {canUpdate && <button type="button" onClick={() => toggleMutation.mutate(task)} disabled={toggleMutation.isPending && toggleMutation.variables?.id === task.id} className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50" aria-label={`Reopen task ${task.title}`}><RotateCcw className="h-3.5 w-3.5" /> Reopen</button>}
              <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through">{task.title}</p>
              {canDelete && <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setPendingDelete(task)} aria-label={`Delete task ${task.title}`}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </li>
          ))}</ul>}
        </div>
      )}

      <TaskDialog
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        startupId={startupId}
        task={editing === "new" ? null : editing}
        pipelineId={pipelineId}
        deals={[{ id: pipelineId, label: dealLabel }]}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && setPendingDelete(null)}
        title="Delete this task?"
        description={
          pendingDelete
            ? `"${pendingDelete.title}" is removed for everyone, along with its due date and assignment.`
            : ""
        }
        confirmLabel="Delete task"
        pendingLabel="Deleting…"
        isPending={deleteMutation.isPending}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
      />
    </section>
  );
}
