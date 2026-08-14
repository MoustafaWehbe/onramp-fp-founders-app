import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, CheckCircle2, ChevronDown, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { DateTimePicker } from "../../../components/ui/date-time-picker";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { usePermissions } from "../../../hooks/usePermissions";
import { apiErrorMessage } from "../../../lib/api-error";
import { listMembers } from "../../../lib/team-api";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  createTask,
  deleteTask,
  listTasks,
  setTaskStatus,
  updateTask,
  type Priority,
  type Task,
} from "../../../lib/task-api";
import { cn } from "../../../lib/utils";

type TaskListProps = {
  startupId: string;
  pipelineId: string;
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

export function TaskList({ startupId, pipelineId }: TaskListProps) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canCreate = can("pipeline", "create");
  const canUpdate = can("pipeline", "update");
  const canDelete = can("pipeline", "delete");

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const tasksQuery = useQuery({
    queryKey: ["tasks", startupId, pipelineId],
    queryFn: () => listTasks(startupId, { pipelineId, limit: 100 }),
  });

  const membersQuery = useQuery({
    queryKey: ["team-members", startupId],
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

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tasks", startupId, pipelineId] });
    // The board's Focus tab and per-card flag are computed from open tasks.
    void queryClient.invalidateQueries({ queryKey: ["pipeline-focus", startupId] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createTask(startupId, {
        pipelineId,
        title: title.trim(),
        priority,
        dueDate: dueDate ? dueDate.toISOString() : null,
        assigneeId: assigneeId || null,
      }),
    onSuccess: () => {
      setTitle("");
      setDueDate(null);
      setPriority("medium");
      setAssigneeId("");
      setComposerOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not add the task")),
  });

  const toggleMutation = useMutation({
    mutationFn: (task: Task) =>
      setTaskStatus(startupId, task.id, task.status === "completed" ? "open" : "completed"),
    onMutate: async (task) => {
      const queryKey = ["tasks", startupId, pipelineId] as const;
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
      void queryClient.invalidateQueries({ queryKey: ["pipeline-focus", startupId] });
    },
    onError: (err, _task, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
      toast.error(apiErrorMessage(err, "Could not update the task"));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", startupId, pipelineId] });
    },
  });

  const postponeMutation = useMutation({
    mutationFn: ({ task, date }: { task: Task; date: Date | null }) =>
      updateTask(startupId, task.id, { dueDate: date ? date.toISOString() : null }),
    onSuccess: invalidate,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not reschedule the task")),
  });

  const deleteMutation = useMutation({
    mutationFn: (task: Task) => deleteTask(startupId, task.id),
    onSuccess: invalidate,
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
        {canCreate && !composerOpen && (
          <Button type="button" size="sm" onClick={() => setComposerOpen(true)}>
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
                <p
                  className={cn(
                    "truncate text-sm",
                    task.status === "completed" && "text-muted-foreground line-through",
                  )}
                >
                  {task.title}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="capitalize">{PRIORITY_LABELS[task.priority]}</span>
                  {memberName(task.assigneeId) && <span>· {memberName(task.assigneeId)}</span>}
                </div>
              </div>

              {task.status === "open" && (
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
              )}

              {canUpdate && (
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
              )}

              {canDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(task)}
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
              {canDelete && <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate(task)} aria-label={`Delete task ${task.title}`}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </li>
          ))}</ul>}
        </div>
      )}

      {canCreate && composerOpen && (
        <form
          className="space-y-4 rounded-2xl border border-primary/20 bg-primary/[0.035] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() === "" || createMutation.isPending) return;
            createMutation.mutate();
          }}
        >
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a task…"
            className="h-10"
            maxLength={200}
            autoFocus
          />
          <div className="grid gap-3 sm:grid-cols-3">
          <Select
            aria-label="Task priority"
            value={priority}
            onValueChange={(value) => setPriority(value as Priority)}
            className="h-9 w-full text-xs"
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
          />
          <Select
            aria-label="Assignee"
            value={assigneeId}
            onValueChange={setAssigneeId}
            className="h-9 w-full text-xs"
            options={[
              { value: "", label: "Unassigned" },
              ...(membersQuery.data ?? []).map((member) => ({
                value: member.id,
                label: member.user
                  ? `${member.user.firstName} ${member.user.lastName}`.trim()
                  : (member.invitedEmail ?? "Pending"),
              })),
            ]}
          />
          <DateTimePicker
            value={dueDate}
            onChange={setDueDate}
            placeholder="Due date"
            className="h-9 w-full"
          />
          </div>
          <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setComposerOpen(false)}>Cancel</Button>
          <Button type="submit" size="sm" disabled={title.trim() === "" || createMutation.isPending}>
            <Plus className="h-4 w-4" />
            {createMutation.isPending ? "Adding…" : "Add task"}
          </Button>
          </div>
        </form>
      )}
    </section>
  );
}
