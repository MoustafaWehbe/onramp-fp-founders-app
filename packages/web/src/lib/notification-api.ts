import { apiClient } from "./api-client";

/** Types the UI renders specially; anything else falls back to a generic bell. */
export type NotificationType = "team_invite" | (string & {});

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

export async function listNotifications(): Promise<NotificationPage> {
  const { data } = await apiClient.get<{
    data: AppNotification[];
    meta: { unreadCount: number };
  }>("/notifications");
  return { items: data.data, unreadCount: data.meta.unreadCount };
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.patch(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post("/notifications/read-all");
}
