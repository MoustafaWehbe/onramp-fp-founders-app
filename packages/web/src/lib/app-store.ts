import { create } from "zustand";
import { notifications as seedNotifications, type Notification } from "./mock-data";

// Non-auth app state — auth is managed by AuthProvider
// Phase 3+ will add activeStartupId and other workspace state here
interface AppState {
  notifications: Notification[];
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
}

export const useAppStore = create<AppState>()((set) => ({
  notifications: seedNotifications,
  markNotificationRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),
  markAllNotificationsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => (n.read ? n : { ...n, read: true })),
    })),
}));

export const useUnreadNotificationCount = () =>
  useAppStore((state) => state.notifications.reduce((total, n) => (n.read ? total : total + 1), 0));
