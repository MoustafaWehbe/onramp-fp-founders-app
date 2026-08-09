import { create } from "zustand";
import { persist } from "zustand/middleware";

// Non-auth app state — auth is managed by AuthProvider, and which workspace is
// actually open is resolved by useWorkspace. This only remembers the user's
// last explicit choice; it is a preference, not a source of truth, because the
// stored id may point at a workspace they have since been removed from.
//
// Notifications used to live here as seeded mock data; they come from
// GET /notifications now, via useNotifications.
interface AppState {
  preferredStartupId: string | null;
  setActiveStartupId: (startupId: string) => void;
  /** Drops the stored preference — it belongs to whoever was signed in. */
  clearActiveStartupId: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      preferredStartupId: null,
      setActiveStartupId: (startupId) => set({ preferredStartupId: startupId }),
      clearActiveStartupId: () => set({ preferredStartupId: null }),
    }),
    {
      // Bumped from the previous key: stored values were seeded with a
      // hardcoded demo startup id that no longer means anything.
      name: "fp:app-store:v2",
      partialize: (state) => ({ preferredStartupId: state.preferredStartupId }),
    },
  ),
);
