import { createContext, useContext } from "react";

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  title: string | null;
  avatarUrl: string | null;
  lastActiveStartupId?: string | null;
}

export interface RegisterInitiateInput {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
}

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  title?: string | null;
}

export interface AuthContextValue {
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
  updateProfile: (input: UpdateProfileInput) => Promise<void>;
  uploadAvatar: (blob: Blob) => Promise<void>;
  removeAvatar: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuthContext must be used within <AuthProvider>");
  return context;
}
