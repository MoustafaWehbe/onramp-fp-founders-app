import { useQuery } from "@tanstack/react-query";
import { fetchAllPages } from "../lib/pagination";
import { qk } from "../lib/query-keys";
import { listTasks, type Task } from "../lib/task-api";

/**
 * Every task on every deal in one round open and completed alike.
 *
 * Dashboard and the pipeline's task queue both read this, so it is defined
 * once: two callers asking the same key for different slices (one filtering
 * `status=open` server-side, one not) would overwrite each other's cache entry
 * and leave whichever rendered second missing rows. Filter the result in the
 * component instead; the whole round is small enough to hold at once.
 */
export function useRoundTasks(startupId: string, roundId: string | null | undefined) {
  return useQuery<{ data: Task[] }>({
    queryKey: qk.tasksForRound(startupId, roundId),
    queryFn: () =>
      fetchAllPages((page, limit) => listTasks(startupId, { roundId: roundId!, page, limit })).then(
        (data) => ({ data }),
      ),
    enabled: Boolean(roundId),
  });
}
