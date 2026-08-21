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
 * The API returns every workspace the user belongs to; we scope the list and
 * unread badge to the active startup so switching Northbeam ↔ Drift Labs
 * swaps the feed without touching other dashboard queries.
 */
export function useNotifications() {
  const queryClient = useQueryClient();
  const { activeStartupId } = useWorkspace();

  const query = useQuery({ queryKey: NOTIFICATIONS_KEY, queryFn: listNotifications });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
    [queryClient],
  );

  const readMutation = useMutation({ mutationFn: markNotificationRead, onSuccess: invalidate });
  const readAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: invalidate,
  });

  const items: NotificationRow[] = useMemo(() => {
    const all = query.data?.items ?? [];
    const scoped = activeStartupId
      ? all.filter((n) => n.startup?.id === activeStartupId)
      : all;
    return scoped.map((n) => ({
      ...n,
      read: n.readAt !== null,
      when: relativeAge(n.createdAt),
    }));
  }, [query.data?.items, activeStartupId]);

  const unreadCount = useMemo(
    () => items.reduce((count, n) => count + (n.read ? 0 : 1), 0),
    [items],
  );

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
