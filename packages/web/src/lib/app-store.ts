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
  /** The round the founder last chose in each startup's pipeline. */
  activeRoundIds: Record<string, string>;
  setActiveStartupId: (startupId: string) => void;
  setActiveRoundId: (startupId: string, roundId: string) => void;
  /** Drops the stored preference — it belongs to whoever was signed in. */
  clearActiveStartupId: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      preferredStartupId: null,
      activeRoundIds: {},
      setActiveStartupId: (startupId) => set({ preferredStartupId: startupId }),
      setActiveRoundId: (startupId, roundId) =>
        set((state) => ({ activeRoundIds: { ...state.activeRoundIds, [startupId]: roundId } })),
      clearActiveStartupId: () => set({ preferredStartupId: null }),
    }),
    {
      // Bumped from the previous key: stored values were seeded with a
      // hardcoded demo startup id that no longer means anything.
      name: "fp:app-store:v2",
      partialize: (state) => ({
        preferredStartupId: state.preferredStartupId,
        activeRoundIds: state.activeRoundIds,
      }),
    },
  ),
);
