import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { useAppStore } from "../lib/app-store";
import { activateStartup, listMyStartups, type WorkspaceSummary } from "../lib/startup-api";

export const MY_STARTUPS_KEY = ["my-startups"] as const;

type Workspace = {
  startups: WorkspaceSummary[];
  activeStartup: WorkspaceSummary | null;
  activeStartupId: string | null;
  setActiveStartupId: (startupId: string) => void;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  /** True only once we know for certain the user belongs to nothing. */
  hasNoWorkspace: boolean;
};

/**
 * Resolves which workspace the app is currently working in.
 *
 * The stored preference is only a hint it can name a workspace the user has
 * been removed from, or one seeded by an older build so it is always
 * validated against the list the server returns rather than trusted outright.
 */
export function useWorkspace(): Workspace {
  const { user, isLoading: isAuthLoading } = useAuth();
  const preferredStartupId = useAppStore((s) => s.preferredStartupId);
  const setPreferredStartupId = useAppStore((s) => s.setActiveStartupId);

  const setActiveStartupId = useCallback(
    (startupId: string) => {
      // Local first so the switch is instant, then tell the server so the
      // choice follows the user to another device. Best-effort on purpose:
      // failing to persist the preference must not block the switch itself.
      setPreferredStartupId(startupId);
      void activateStartup(startupId).catch(() => {
        /* the local preference still stands */
      });
    },
    [setPreferredStartupId],
  );

  const query = useQuery({
    queryKey: MY_STARTUPS_KEY,
    queryFn: listMyStartups,
    enabled: Boolean(user),
  });

  const startups = useMemo(() => query.data ?? [], [query.data]);

  const activeStartup = useMemo(() => {
    if (startups.length === 0) return null;
    return (
      startups.find((s) => s.id === preferredStartupId) ??
      startups.find((s) => s.id === user?.lastActiveStartupId) ??
      startups[0]
    );
  }, [startups, preferredStartupId, user?.lastActiveStartupId]);

  const isLoading = isAuthLoading || (Boolean(user) && query.isPending);

  return {
    startups,
    activeStartup: activeStartup ?? null,
    activeStartupId: activeStartup?.id ?? null,
    setActiveStartupId,
    isLoading,
    isError: query.isError,
    error: query.error,
    hasNoWorkspace: Boolean(user) && !isLoading && !query.isError && startups.length === 0,
  };
}

/**
 * The active workspace id, for screens that cannot render without one.
 * Safe only beneath RequireWorkspace, which is what guarantees it exists.
 */
export function useActiveStartupId(): string {
  const { activeStartupId } = useWorkspace();

  if (!activeStartupId) {
    throw new Error(
      "useActiveStartupId was called outside a workspace-guarded route wrap the route in <RequireWorkspace>",
    );
  }

  return activeStartupId;
}
