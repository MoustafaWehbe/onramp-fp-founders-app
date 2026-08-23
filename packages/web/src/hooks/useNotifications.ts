import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "../lib/notification-api";
import { useWorkspace } from "./useWorkspace";

export const NOTIFICATIONS_KEY = ["notifications"] as const;

export type NotificationRow = AppNotification & {
  read: boolean;
  /** Short relative age, e.g. "2h" the list is scanned, not studied. */
  when: string;
};

const UNITS: [limit: number, divisor: number, suffix: string][] = [
  [60, 1, "s"],
  [3600, 60, "m"],
  [86_400, 3600, "h"],
  [604_800, 86_400, "d"],
];

function relativeAge(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);

  for (const [limit, divisor, suffix] of UNITS) {
    if (seconds < limit) return `${Math.floor(seconds / divisor)}${suffix}`;
  }

  return `${Math.floor(seconds / 604_800)}w`;
}

/**
 * The notification feed, shared by the header menu and the full page so both
 * read the same cache entry and a read in one is reflected in the other.
 *
 * Scoped to the active startup server-side (both the page and unreadCount)
 * so switching Northbeam ↔ Drift Labs swaps the feed without touching other
 * dashboard queries, and the badge always agrees with what the page shows -
 * a client-side filter on top of a fixed-size page could previously drop a
 * workspace's own items (and miscount unread) once another workspace's
 * notifications filled the page ahead of them.
 */
export function useNotifications() {
  const queryClient = useQueryClient();
  const { activeStartupId } = useWorkspace();

  const queryKey = useMemo(() => [...NOTIFICATIONS_KEY, activeStartupId] as const, [activeStartupId]);
  const query = useQuery({
    queryKey,
    queryFn: () => listNotifications(activeStartupId ?? undefined),
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
    [queryClient],
  );

  const readMutation = useMutation({ mutationFn: markNotificationRead, onSuccess: invalidate });
  const readAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(activeStartupId ?? undefined),
    onSuccess: invalidate,
  });

  const items: NotificationRow[] = useMemo(() => {
    const all = query.data?.items ?? [];
    return all.map((n) => ({
      ...n,
      read: n.readAt !== null,
      when: relativeAge(n.createdAt),
    }));
  }, [query.data?.items]);

  const unreadCount = query.data?.unreadCount ?? 0;

  return {
    items,
    unreadCount,
    isPending: query.isPending,
    isError: query.isError,
    markRead: readMutation.mutate,
    markAllRead: readAllMutation.mutate,
    isMarkingAll: readAllMutation.isPending,
  };
}
