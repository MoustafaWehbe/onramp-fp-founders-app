import { useAuthContext } from "../providers/auth-context";

export function useAuth() {
  return useAuthContext();
}
