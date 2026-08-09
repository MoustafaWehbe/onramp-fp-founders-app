import { Navigate, Outlet } from "react-router-dom";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { Button } from "../components/ui/button";
import { useWorkspace } from "../hooks/useWorkspace";
import { apiErrorMessage } from "../lib/api-error";

/**
 * Guards every screen that cannot render without a startup id — without this
 * each panel fails on its own. The dashboard and notifications sit outside it
 * on purpose: someone who has skipped creating a startup still needs somewhere
 * to land, and somewhere to accept an invitation from.
 */
export function RequireWorkspace() {
  const { isLoading, isError, error, hasNoWorkspace } = useWorkspace();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (isError) {
    // Distinct from "no workspace" — bouncing someone to the empty-state
    // dashboard because the network hiccuped would invite a duplicate startup.
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          <p className="font-display text-base font-semibold">Couldn't load your workspaces</p>
          <p className="mt-2">{apiErrorMessage(error, "Please try again in a moment.")}</p>
          <Button
            className="mt-4"
            size="sm"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (hasNoWorkspace) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
