import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListPlus, Users, X } from "lucide-react";
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
import { apiErrorMessage } from "../../../lib/api-error";
import { runWithConcurrency } from "../../../lib/concurrency";
import { updatePipelineEntry, type PipelineEntry } from "../../../lib/pipeline-api";
import { invalidateDealData, invalidateTaskData, qk } from "../../../lib/query-keys";
import { listMembers } from "../../../lib/team-api";
import { PRIORITIES, PRIORITY_LABELS, createTask, type Priority } from "../../../lib/task-api";

/** Four at a time: fast enough to feel instant, gentle enough on the API. */
const BULK_CONCURRENCY = 4;

type BulkActionsBarProps = {
  startupId: string;
  selected: PipelineEntry[];
  canUpdate: boolean;
  canCreate: boolean;
  onSelectAll: () => void;
  onClear: () => void;
};

/** "3 of 5 succeeded" phrasing a bulk action must never claim more than it did. */
function reportOutcome(
  results: PromiseSettledResult<unknown>[],
  { done, failed }: { done: (count: number) => string; failed: string },
): void {
  const failures = results.filter((result) => result.status === "rejected");
  const succeeded = results.length - failures.length;
  if (succeeded > 0) toast.success(done(succeeded));
  if (failures.length > 0) {
    toast.error(
      `${failed} for ${failures.length} ${failures.length === 1 ? "investor" : "investors"}. ${apiErrorMessage(
        (failures[0] as PromiseRejectedResult).reason,
        "Try those again.",
      )}`,
    );
  }
}

/**
 * Acts on every picked card at once. Assigning ten deals to a teammate, or
 * giving a batch of new investors the same first next step, was ten trips
 * through the deal sheet the kind of chore that quietly stops happening.
 */
export function BulkActionsBar({
  startupId,
  selected,
  canUpdate,
  canCreate,
  onSelectAll,
  onClear,
}: BulkActionsBarProps) {
  const queryClient = useQueryClient();
  const [taskOpen, setTaskOpen] = useState(false);
  const [ownerId, setOwnerId] = useState("");

  const membersQuery = useQuery({
    queryKey: qk.members(startupId),
    queryFn: () => listMembers(startupId),
  });

  const memberOptions = [
    { value: "", label: "Assign owner…" },
    ...(membersQuery.data ?? []).map((member) => ({
      value: member.id,
      label: member.user
        ? `${member.user.firstName} ${member.user.lastName}`.trim()
        : (member.invitedEmail ?? "Pending invite"),
    })),
  ];

  const assignMutation = useMutation({
    mutationFn: (nextOwnerId: string) =>
      runWithConcurrency(selected, BULK_CONCURRENCY, (deal) =>
        updatePipelineEntry(startupId, deal.id, { ownerId: nextOwnerId }),
      ),
    onSuccess: (results) => {
      reportOutcome(results, {
        done: (count) => `${count} ${count === 1 ? "deal" : "deals"} reassigned`,
        failed: "Could not change the owner",
      });
      invalidateDealData(queryClient, startupId);
      setOwnerId("");
      onClear();
    },
  });

  const busy = assignMutation.isPending;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.05] px-3 py-2">
        <span className="text-sm font-medium">
          {selected.length} selected
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canUpdate && (
            <div className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-muted-foreground" />
              <Select
                aria-label="Assign an owner to every selected deal"
                value={ownerId}
                disabled={busy || selected.length === 0}
                onValueChange={(value) => {
                  setOwnerId(value);
                  // Selecting a name is the action an extra "apply" click
                  // buys nothing when the bar disappears straight afterwards.
                  if (value !== "") assignMutation.mutate(value);
                }}
                options={memberOptions}
                className="h-8 w-48 text-xs"
              />
            </div>
          )}

          {canCreate && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || selected.length === 0}
              onClick={() => setTaskOpen(true)}
            >
              <ListPlus className="h-4 w-4" /> Add task to all
            </Button>
          )}

          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onSelectAll}>
            Select all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onClear}
            aria-label="Leave selection mode"
          >
            <X className="h-4 w-4" /> Done
          </Button>
        </div>
      </div>

      <BulkTaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        startupId={startupId}
        selected={selected}
        members={memberOptions}
        onDone={() => {
          invalidateTaskData(queryClient, startupId);
          setTaskOpen(false);
          onClear();
        }}
      />
    </>
  );
}

type BulkTaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startupId: string;
  selected: PipelineEntry[];
  members: { value: string; label: string }[];
  onDone: () => void;
};

/** One task, copied onto every selected deal same title, owner and due date. */
function BulkTaskDialog({
  open,
  onOpenChange,
  startupId,
  selected,
  members,
  onDone,
}: BulkTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeId, setAssigneeId] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDueDate(null);
    setPriority("medium");
    setAssigneeId("");
  }, [open]);

  const createMutation = useMutation({
    mutationFn: () =>
      runWithConcurrency(selected, BULK_CONCURRENCY, (deal) =>
        createTask(startupId, {
          pipelineId: deal.id,
          title: title.trim(),
          priority,
          dueDate: dueDate ? dueDate.toISOString() : null,
          assigneeId: assigneeId || null,
        }),
      ),
    onSuccess: (results) => {
      reportOutcome(results, {
        done: (count) => `Task added to ${count} ${count === 1 ? "deal" : "deals"}`,
        failed: "Could not add the task",
      });
      onDone();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !createMutation.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Add a task to {selected.length} {selected.length === 1 ? "investor" : "investors"}
          </DialogTitle>
          <DialogDescription>
            Each selected deal gets its own copy, so they can be completed one at a time.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() === "" || createMutation.isPending) return;
            createMutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="bulk-task-title">Task</Label>
            <Input
              id="bulk-task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Send the updated deck"
              maxLength={200}
              autoFocus
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-task-due">Due date</Label>
              <DateTimePicker
                id="bulk-task-due"
                value={dueDate}
                onChange={setDueDate}
                placeholder="No due date"
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-task-priority">Priority</Label>
              <Select
                id="bulk-task-priority"
                value={priority}
                onValueChange={(value) => setPriority(value as Priority)}
                options={PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-task-assignee">Assignee</Label>
              <Select
                id="bulk-task-assignee"
                value={assigneeId}
                onValueChange={setAssigneeId}
                options={members.map((member) =>
                  member.value === "" ? { value: "", label: "Unassigned" } : member,
                )}
              />
            </div>
          </div>

          <div className="max-h-28 overflow-y-auto rounded-lg border border-border/70 bg-surface/40 p-2 text-xs text-muted-foreground">
            {selected.map((deal) => deal.investor.fullName).join(", ")}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={createMutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={title.trim() === "" || createMutation.isPending}>
              <ListPlus className="h-4 w-4" />
              {createMutation.isPending ? "Adding…" : `Add to ${selected.length}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
