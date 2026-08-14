import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "../../../components/ui/checkbox";
import { useAuth } from "../../../hooks/useAuth";
import { usePermissions } from "../../../hooks/usePermissions";
import { apiErrorMessage } from "../../../lib/api-error";
import type { PipelineEntry } from "../../../lib/pipeline-api";
import { listMembers } from "../../../lib/team-api";
import { PRIORITY_LABELS, listTasks, setTaskStatus, type Task } from "../../../lib/task-api";
import { cn } from "../../../lib/utils";

type TaskQueueProps = {
  startupId: string;
  roundId: string | null;
  /** Puts an investor name against each task; keyed by pipeline id. */
  entriesById: Map<string, PipelineEntry>;
  onOpenDeal: (pipelineId: string) => void;
};

type Scope = "mine" | "everyone";

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
 * Every open task across the round in one list. Tasks were only reachable by
 * opening the one deal that owned them, so work assigned to you was invisible
 * unless you already knew where to look.
 */
export function TaskQueue({ startupId, roundId, entriesById, onOpenDeal }: TaskQueueProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canUpdate = can("pipeline", "update");
  const [scope, setScope] = useState<Scope>("mine");

  const membersQuery = useQuery({
    queryKey: ["team-members", startupId],
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

  const tasksQuery = useQuery({
    queryKey: ["tasks", startupId, "round", roundId],
    queryFn: () => listTasks(startupId, { roundId: roundId!, status: "open", limit: 100 }),
    enabled: roundId !== null,
  });

  const toggleMutation = useMutation({
    mutationFn: (task: Task) => setTaskStatus(startupId, task.id, "completed"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", startupId] });
      void queryClient.invalidateQueries({ queryKey: ["pipeline-focus", startupId] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update the task")),
  });

  const now = Date.now();
  const all = tasksQuery.data?.data ?? [];
  const mineCount = myMemberId
    ? all.filter((task) => task.assigneeId === myMemberId).length
    : 0;
  const tasks = scope === "mine" && myMemberId
    ? all.filter((task) => task.assigneeId === myMemberId)
    : all;

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Task scope"
        className="inline-flex items-center gap-1 rounded-xl border border-border/70 bg-surface/60 p-1"
      >
        {(
          [
            { id: "mine" as const, label: "Assigned to me", count: mineCount },
            { id: "everyone" as const, label: "Everyone", count: all.length },
          ]
        ).map((option) => (
          <button
            key={option.id}
            role="tab"
            type="button"
            aria-selected={scope === option.id}
            onClick={() => setScope(option.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
              scope === option.id
                ? "bg-card font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {option.count}
            </span>
          </button>
        ))}
      </div>

      {tasksQuery.isPending && (
        <div className="rounded-xl border border-border/70 bg-surface/50 px-4 py-10 text-center text-sm text-muted-foreground">
          Loading tasks…
        </div>
      )}

      {!tasksQuery.isPending && tasks.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 px-6 py-14 text-center">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-success/15 text-success">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <p className="font-display text-base font-semibold">
            {scope === "mine" ? "Nothing assigned to you" : "No open tasks in this round"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Tasks are added from a deal — open one from the board to set its next step.
          </p>
        </div>
      )}

      {tasks.length > 0 && (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const deal = entriesById.get(task.pipelineId);
            const due = dueLabel(task.dueDate, now);
            const assignee = memberName(task.assigneeId);

            return (
              <li
                key={task.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-surface/50 p-3"
              >
                <Checkbox
                  checked={false}
                  disabled={!canUpdate || toggleMutation.isPending}
                  onChange={() => toggleMutation.mutate(task)}
                  aria-label={`Complete task ${task.title}`}
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{task.title}</p>
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
                    {assignee && <span>· {assignee}</span>}
                    {!task.assigneeId && <span>· Unassigned</span>}
                  </div>
                </div>

                <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs", due.tone)}>
                  <CalendarClock className="h-3.5 w-3.5" />
                  {due.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
