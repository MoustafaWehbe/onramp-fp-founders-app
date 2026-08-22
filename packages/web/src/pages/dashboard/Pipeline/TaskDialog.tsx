import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { DateTimePicker } from "../../../components/ui/date-time-picker";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import { usePermissions } from "../../../hooks/usePermissions";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-error";
import { invalidateTaskData, qk } from "../../../lib/query-keys";
import { listMembers } from "../../../lib/team-api";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  createTask,
  deleteTask,
  updateTask,
  type Priority,
  type Task,
} from "../../../lib/task-api";

/** A deal a task can be filed against, already reduced to what the picker shows. */
export type TaskDealOption = { id: string; label: string };

type TaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startupId: string;
  /** The task being edited, or null to create a new one. */
  task: Task | null;
  /** Which deal a new task lands on. Ignored when editing. */
  pipelineId: string | null;
  /**
   * Deals this task may be linked to. With a single option the link is shown
   * as fixed context; with several it becomes an editable field, which is the
   * only way to fix a task filed against the wrong investor without losing it.
   */
  deals: TaskDealOption[];
  onSaved?: () => void;
};

function taskErrorMessage(err: unknown, fallback: string): string {
  switch (apiErrorCode(err)) {
    case "TASK_NOT_FOUND":
      return "That task no longer exists a teammate may have removed it.";
    case "PIPELINE_NOT_FOUND":
      return "That deal is no longer on the board.";
    case "MEMBER_NOT_FOUND":
      return "That teammate is no longer a member of this workspace.";
    default:
      return apiErrorMessage(err, fallback, "You don't have permission to change this task.");
  }
}

/**
 * The one place a task is written. Creating and editing share it so the two
 * paths can never offer different fields before this, a task could be given
 * an assignee and due date on the way in but only its due date could be
 * changed afterwards, and a wrong title or investor meant deleting and
 * retyping the whole thing.
 */
export function TaskDialog({
  open,
  onOpenChange,
  startupId,
  task,
  pipelineId,
  deals,
  onSaved,
}: TaskDialogProps) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canDelete = can("pipeline", "delete");
  const isEditing = task !== null;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [dealId, setDealId] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reload the form from whatever the dialog was opened with. Keyed on `open`
  // as well so reopening after a cancelled edit shows stored values, not the
  // abandoned draft.
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setPriority(task?.priority ?? "medium");
    setDueDate(task?.dueDate ? new Date(task.dueDate) : null);
    setAssigneeId(task?.assigneeId ?? "");
    setDealId(task?.pipelineId ?? pipelineId ?? "");
    setConfirmingDelete(false);
  }, [open, task, pipelineId]);

  const membersQuery = useQuery({
    queryKey: qk.members(startupId),
    queryFn: () => listMembers(startupId),
    enabled: open,
  });

  const settle = (message: string) => {
    toast.success(message);
    invalidateTaskData(queryClient, startupId);
    onSaved?.();
    onOpenChange(false);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        dueDate: dueDate ? dueDate.toISOString() : null,
        assigneeId: assigneeId || null,
      };
      return task
        ? updateTask(startupId, task.id, {
            ...payload,
            // Only sent when it actually moved; an unchanged link is not an edit.
            ...(dealId !== task.pipelineId && dealId !== "" && { pipelineId: dealId }),
          })
        : createTask(startupId, { pipelineId: dealId, ...payload });
    },
    onSuccess: () => settle(isEditing ? "Task updated" : "Task added"),
    onError: (err) =>
      toast.error(taskErrorMessage(err, isEditing ? "Could not update the task" : "Could not add the task")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(startupId, task!.id),
    onSuccess: () => settle("Task removed"),
    onError: (err) => toast.error(taskErrorMessage(err, "Could not remove the task")),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;
  const canSubmit = title.trim() !== "" && dealId !== "" && !busy;
  const dealLabel = deals.find((deal) => deal.id === dealId)?.label ?? "this deal";

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Change what this next step is, when it's due, and who owns it."
              : `Set the next step for ${dealLabel}.`}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            saveMutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Task</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Send the updated deck"
              maxLength={200}
              autoFocus
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Due date</Label>
              <DateTimePicker
                id="task-due"
                value={dueDate}
                onChange={setDueDate}
                placeholder="No due date"
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-assignee">Assignee</Label>
              <Select
                id="task-assignee"
                value={assigneeId}
                onValueChange={setAssigneeId}
                options={[
                  { value: "", label: "Unassigned" },
                  ...(membersQuery.data ?? []).map((member) => ({
                    value: member.id,
                    label: member.user
                      ? `${member.user.firstName} ${member.user.lastName}`.trim()
                      : (member.invitedEmail ?? "Pending invite"),
                  })),
                ]}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-priority">Priority</Label>
              <Select
                id="task-priority"
                value={priority}
                onValueChange={(value) => setPriority(value as Priority)}
                options={PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-deal">Investor</Label>
              {deals.length > 1 ? (
                <Select
                  id="task-deal"
                  value={dealId}
                  onValueChange={setDealId}
                  options={deals.map((deal) => ({ value: deal.id, label: deal.label }))}
                />
              ) : (
                <div
                  id="task-deal"
                  className="flex h-9 items-center truncate rounded-md border border-border/70 bg-surface/40 px-3 text-sm text-muted-foreground"
                >
                  {dealLabel}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-description">Notes</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Anything the owner needs to know before doing this…"
              maxLength={2000}
              className="min-h-20 resize-y"
            />
          </div>

          {confirmingDelete ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/35 bg-destructive/6 p-3">
              <p className="text-sm text-destructive">
                Delete this task? It can't be recovered.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Keep it
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => deleteMutation.mutate()}
                >
                  {deleteMutation.isPending ? "Deleting…" : "Delete task"}
                </Button>
              </div>
            </div>
          ) : (
            <DialogFooter className="sm:justify-between">
              {isEditing && canDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSubmit}>
                  <Save className="h-4 w-4" />
                  {saveMutation.isPending
                    ? "Saving…"
                    : isEditing
                      ? "Save changes"
                      : "Add task"}
                </Button>
              </div>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
