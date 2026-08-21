import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/api-client";
import { useAppStore } from "../lib/app-store";
import {
  AuthContext,
  type AuthUser,
  type RegisterInitiateInput,
  type UpdateProfileInput,
} from "./auth-context";

export type { AuthUser, UpdateProfileInput } from "./auth-context";

// Non-sensitive session hint: which account this tab believes it is signed in
// as. Tells the client whether to attempt a restore, and lets other tabs notice
// that the identity changed underneath them. The actual auth is always
// validated server-side via HttpOnly cookies.
const SESSION_KEY = "fp:has-session";

function readSessionHint(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

function markSession(userId: string) {
  localStorage.setItem(SESSION_KEY, userId);
}

function clearSessionHint() {
  localStorage.removeItem(SESSION_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const hasSessionHint = Boolean(readSessionHint());
  const queryClient = useQueryClient();

  const [user, setUser] = useState<AuthUser | null>(null);
  // Only show a loading state if we expect a session to restore.
  // Unauthenticated users get isLoading=false immediately no spinner.
  const [isLoading, setIsLoading] = useState(hasSessionHint);

  /**
   * Every cached query was fetched as somebody. Carrying that cache across a
   * sign-in hands the next account the previous one's workspaces, roles and
   * lists: react-query serves them from cache on the spot and only corrects
   * itself on the following refetch, which is why a manual refresh appeared to
   * "fix" it. The stored workspace preference is user-scoped for the same
   * reason the server's lastActiveStartupId is what remembers it properly.
   */
  const resetIdentityScopedState = useCallback(() => {
    queryClient.clear();
    useAppStore.getState().clearActiveStartupId();
  }, [queryClient]);

  useEffect(() => {
    if (!readSessionHint()) {
      // No hint skip the probe entirely, nothing to restore.
      return;
    }

    let mounted = true;
    const controller = new AbortController();

    apiClient
      .get<{ data: AuthUser }>("/auth/me", { signal: controller.signal })
      .then(({ data }) => {
        if (!mounted) return;
        // The cookie may belong to an account this tab has never seen another
        // tab could have signed in as somebody else while this one sat idle.
        if (readSessionHint() !== data.data.id) {
          resetIdentityScopedState();
          markSession(data.data.id);
        }
        setUser(data.data);
      })
      .catch((err) => {
        if (mounted && !axios.isCancel(err)) {
          // Session is gone (cookies expired/cleared) remove the hint.
          clearSessionHint();
        }
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [resetIdentityScopedState]);

  // Signing in or out in another tab swaps the cookie for this one too. Without
  // this the idle tab keeps rendering the old account until it is reloaded.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== SESSION_KEY || event.newValue === user?.id) return;

      resetIdentityScopedState();

      if (!event.newValue) {
        setUser(null);
        return;
      }

      apiClient
        .get<{ data: AuthUser }>("/auth/me")
        .then(({ data }) => setUser(data.data))
        .catch(() => setUser(null));
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user?.id, resetIdentityScopedState]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const { data } = await apiClient.post<{ data: { user: AuthUser } }>(
      "/auth/login",
      { email, password },
    );
    // Before setUser, so the first render as the new account already sees an
    // empty cache and loads rather than flashing the previous account's data.
    resetIdentityScopedState();
    markSession(data.data.user.id);
    setUser(data.data.user);
  }, [resetIdentityScopedState]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiClient.post("/auth/logout");
    } finally {
      resetIdentityScopedState();
      clearSessionHint();
      setUser(null);
    }
  }, [resetIdentityScopedState]);

  const registerInitiate = useCallback(async (
    input: RegisterInitiateInput,
  ): Promise<{ email: string; expires_in_seconds: number }> => {
    const { data } = await apiClient.post<{
      data: { email: string; expires_in_seconds: number; message: string };
    }>("/auth/register/initiate", input);
    return { email: data.data.email, expires_in_seconds: data.data.expires_in_seconds };
  }, []);

  const registerVerify = useCallback(async (email: string, otp: string): Promise<void> => {
    const { data } = await apiClient.post<{ data: { user: AuthUser } }>(
      "/auth/register/verify",
      { email, otp },
    );
    resetIdentityScopedState();
    markSession(data.data.user.id);
    setUser(data.data.user);
  }, [resetIdentityScopedState]);

  const registerResend = useCallback(async (email: string): Promise<void> => {
    await apiClient.post("/auth/register/resend", { email });
  }, []);

  const forgotPassword = useCallback(async (email: string): Promise<string> => {
    const { data } = await apiClient.post<{ data: { message: string } }>(
      "/auth/forgot-password",
      { email },
    );
    return data.data.message;
  }, []);

  const resetPassword = useCallback(async (token: string, newPassword: string): Promise<void> => {
    await apiClient.post("/auth/reset-password", { token, new_password: newPassword });
  }, []);

  const googleAuth = useCallback(async (idToken: string): Promise<void> => {
    const { data } = await apiClient.post<{ data: { user: AuthUser } }>(
      "/auth/google",
      { id_token: idToken },
    );
    resetIdentityScopedState();
    markSession(data.data.user.id);
    setUser(data.data.user);
  }, [resetIdentityScopedState]);

  const updateProfile = useCallback(async (input: UpdateProfileInput): Promise<void> => {
    const { data } = await apiClient.patch<{ data: AuthUser }>("/users/me", input);
    setUser(data.data);
  }, []);

  const uploadAvatar = useCallback(async (blob: Blob): Promise<void> => {
    const { data } = await apiClient.put<{ data: AuthUser }>("/users/me/avatar", blob, {
      headers: { "Content-Type": blob.type || "image/webp" },
    });
    setUser(data.data);
  }, []);

  const removeAvatar = useCallback(async (): Promise<void> => {
    const { data } = await apiClient.delete<{ data: AuthUser }>("/users/me/avatar");
    setUser(data.data);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        registerInitiate,
        registerVerify,
        registerResend,
        forgotPassword,
        resetPassword,
        googleAuth,
        updateProfile,
        uploadAvatar,
        removeAvatar,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
