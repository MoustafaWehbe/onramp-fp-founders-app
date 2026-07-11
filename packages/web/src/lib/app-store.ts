import { create } from "zustand";

// Non-auth app state — auth is managed by AuthProvider
// Phase 3+ will add activeStartupId and other workspace state here
interface AppState {
  _placeholder: null;
}

export const useAppStore = create<AppState>()(() => ({ _placeholder: null }));
