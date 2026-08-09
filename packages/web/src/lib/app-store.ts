import { create } from "zustand";
import { persist } from "zustand/middleware";
import { notifications as seedNotifications, type Notification } from "./mock-data";

// Non-auth app state — auth is managed by AuthProvider, and which workspace is
// actually open is resolved by useWorkspace. This only remembers the user's
// last explicit choice; it is a preference, not a source of truth, because the
// stored id may point at a workspace they have since been removed from.
interface AppState {
  preferredStartupId: string | null;
  setActiveStartupId: (startupId: string) => void;
  notifications: Notification[];
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      preferredStartupId: null,
      setActiveStartupId: (startupId) => set({ preferredStartupId: startupId }),
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
      // Bumped from the previous key: stored values were seeded with a
      // hardcoded demo startup id that no longer means anything.
      name: "fp:app-store:v2",
      partialize: (state) => ({ preferredStartupId: state.preferredStartupId }),
    },
  ),
);

export const useUnreadNotificationCount = () =>
  useAppStore((state) => state.notifications.reduce((total, n) => (n.read ? total : total + 1), 0));
