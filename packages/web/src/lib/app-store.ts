import { create } from "zustand";
import { persist } from "zustand/middleware";
import { notifications as seedNotifications, type Notification } from "./mock-data";

/** Seeded Acme Corp startup — used until a real startup switcher is wired. */
export const SEED_STARTUP_ID = "00000000-0000-0000-0000-000000000002";

// Non-auth app state — auth is managed by AuthProvider
interface AppState {
  activeStartupId: string;
  setActiveStartupId: (startupId: string) => void;
  notifications: Notification[];
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeStartupId: SEED_STARTUP_ID,
      setActiveStartupId: (startupId) => set({ activeStartupId: startupId }),
      notifications: seedNotifications,
      markNotificationRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          ),
        })),
      markAllNotificationsRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => (n.read ? n : { ...n, read: true })),
        })),
    }),
    {
      name: "fp:app-store",
      partialize: (state) => ({ activeStartupId: state.activeStartupId }),
    },
  ),
);

export const useUnreadNotificationCount = () =>
  useAppStore((state) => state.notifications.reduce((total, n) => (n.read ? total : total + 1), 0));

export const useActiveStartupId = () =>
  useAppStore((state) => {
    const id = state.activeStartupId;
    return /^[0-9a-f-]{36}$/i.test(id) ? id : SEED_STARTUP_ID;
  });