import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import axios from "axios";
import { apiClient } from "../lib/api-client";

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

interface RegisterInitiateInput {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  registerInitiate: (input: RegisterInitiateInput) => Promise<{ email: string; expires_in_seconds: number }>;
  registerVerify: (email: string, otp: string) => Promise<void>;
  registerResend: (email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<string>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  googleAuth: (idToken: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Non-sensitive session hint. Tells the client whether to attempt a restore.
// The actual auth is always validated server-side via HttpOnly cookies.
const SESSION_KEY = "fp:has-session";

function markSession() {
  localStorage.setItem(SESSION_KEY, "1");
}

function clearSessionHint() {
  localStorage.removeItem(SESSION_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const hasSessionHint = localStorage.getItem(SESSION_KEY) === "1";

  const [user, setUser] = useState<AuthUser | null>(null);
  // Only show a loading state if we expect a session to restore.
  // Unauthenticated users get isLoading=false immediately — no spinner.
  const [isLoading, setIsLoading] = useState(hasSessionHint);

  useEffect(() => {
    if (localStorage.getItem(SESSION_KEY) !== "1") {
      // No hint — skip the probe entirely, nothing to restore.
      return;
    }

    let mounted = true;
    const controller = new AbortController();

    apiClient
      .get<{ data: AuthUser }>("/auth/me", { signal: controller.signal })
      .then(({ data }) => {
        if (mounted) setUser(data.data);
      })
      .catch((err) => {
        if (mounted && !axios.isCancel(err)) {
          // Session is gone (cookies expired/cleared) — remove the hint.
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
  }, []);

  async function login(email: string, password: string): Promise<void> {
    const { data } = await apiClient.post<{ data: { user: AuthUser } }>(
      "/auth/login",
      { email, password },
    );
    markSession();
    setUser(data.data.user);
  }

  async function logout(): Promise<void> {
    try {
      await apiClient.post("/auth/logout");
    } finally {
      clearSessionHint();
      setUser(null);
    }
  }

  async function registerInitiate(
    input: RegisterInitiateInput,
  ): Promise<{ email: string; expires_in_seconds: number }> {
    const { data } = await apiClient.post<{
      data: { email: string; expires_in_seconds: number; message: string };
    }>("/auth/register/initiate", input);
    return { email: data.data.email, expires_in_seconds: data.data.expires_in_seconds };
  }

  async function registerVerify(email: string, otp: string): Promise<void> {
    const { data } = await apiClient.post<{ data: { user: AuthUser } }>(
      "/auth/register/verify",
      { email, otp },
    );
    markSession();
    setUser(data.data.user);
  }

  async function registerResend(email: string): Promise<void> {
    await apiClient.post("/auth/register/resend", { email });
  }

  async function forgotPassword(email: string): Promise<string> {
    const { data } = await apiClient.post<{ data: { message: string } }>(
      "/auth/forgot-password",
      { email },
    );
    return data.data.message;
  }

  async function resetPassword(token: string, newPassword: string): Promise<void> {
    await apiClient.post("/auth/reset-password", { token, new_password: newPassword });
  }

  async function googleAuth(idToken: string): Promise<void> {
    const { data } = await apiClient.post<{ data: { user: AuthUser } }>(
      "/auth/google",
      { id_token: idToken },
    );
    markSession();
    setUser(data.data.user);
  }

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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within <AuthProvider>");
  return ctx;
}
