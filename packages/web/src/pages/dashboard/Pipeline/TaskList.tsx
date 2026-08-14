import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
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
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not add the task")),
  });

  const toggleMutation = useMutation({
    mutationFn: (task: Task) =>
      setTaskStatus(startupId, task.id, task.status === "completed" ? "open" : "completed"),
    onSuccess: invalidate,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update the task")),
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
    <section aria-label="Tasks" className="space-y-2">
      <h3 className="font-display text-sm font-semibold">Tasks</h3>

      {tasksQuery.isPending && (
        <p className="text-xs text-muted-foreground">Loading tasks…</p>
      )}

      {!tasksQuery.isPending && tasks.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No tasks yet — add the next step for this deal.
        </p>
      )}

      {[...open, ...completed].length > 0 && (
        <ul className="space-y-1.5">
          {[...open, ...completed].map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-surface/50 px-2.5 py-2"
            >
              <Checkbox
                checked={task.status === "completed"}
                disabled={!canUpdate || toggleMutation.isPending}
                onChange={() => toggleMutation.mutate(task)}
                aria-label={task.status === "completed" ? "Reopen task" : "Complete task"}
              />
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

      {canCreate && (
        <form
          className="flex flex-wrap items-center gap-2 pt-1"
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
            className="h-8 min-w-40 flex-1"
            maxLength={200}
          />
          <Select
            aria-label="Task priority"
            value={priority}
            onValueChange={(value) => setPriority(value as Priority)}
            className="h-8 w-auto min-w-28 text-xs"
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
          />
          <Select
            aria-label="Assignee"
            value={assigneeId}
            onValueChange={setAssigneeId}
            className="h-8 w-auto min-w-36 text-xs"
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
            className="h-8 w-auto"
          />
          <Button type="submit" size="sm" disabled={title.trim() === "" || createMutation.isPending}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </form>
      )}
    </section>
  );
}
