import { apiClient } from "./api-client";

/** Types the UI renders specially; anything else falls back to a generic bell. */
export type NotificationType =
  | "team_invite"
  | "followup_due"
  | "task_overdue"
  | "task_due_today"
  | "task_assigned"
  | "lead_stale"
  | "deal_no_next_step"
  | "reviewer_opened"
  | (string & {});

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
  startup: { id: string; name: string } | null;
};

export type NotificationPage = {
  items: AppNotification[];
  unreadCount: number;
};

/**
 * Scoping by startupId (typically the active workspace) is done server-side
 * so the returned page and unreadCount agree with each other a client-side
 * filter on top of a fixed-size page can silently drop a workspace's own
 * items (and recompute a wrong badge) once another workspace fills the page.
 * Omit it for the unscoped, cross-workspace view.
 */
export async function listNotifications(startupId?: string): Promise<NotificationPage> {
  const { data } = await apiClient.get<{
    data: AppNotification[];
    meta: { unreadCount: number };
  }>("/notifications", { params: startupId ? { startupId } : undefined });
  return { items: data.data, unreadCount: data.meta.unreadCount };
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.patch(`/notifications/${id}/read`);
}

/** Scoped to startupId (typically the active workspace) so this only clears what the caller's own feed currently shows. */
export async function markAllNotificationsRead(startupId?: string): Promise<void> {
  await apiClient.post("/notifications/read-all", startupId ? { startupId } : {});
}
