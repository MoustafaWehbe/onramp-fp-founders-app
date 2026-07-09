import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  user: { email: string; firstName: string; lastName: string } | null;
  login: (email: string, firstName?: string, lastName?: string) => void;
  register: (email: string, firstName: string, lastName: string) => void;
  logout: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      login: (email, firstName = "User", lastName = "User") => {
        set({ user: { email, firstName, lastName } });
        localStorage.setItem("auth_user", JSON.stringify({ email, firstName, lastName }));
      },
      register: (email, firstName, lastName) => {
        set({ user: { email, firstName, lastName } });
        localStorage.setItem("auth_user", JSON.stringify({ email, firstName, lastName }));
      },
      logout: () => {
        set({ user: null });
        localStorage.removeItem("auth_user");
      },
    }),
    {
      name: "app-store",
      storage: {
        getItem: (name) => {
          const item = localStorage.getItem(name);
          return item ? JSON.parse(item) : null;
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
    }
  )
);
