import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../../hooks/useAuth";
import { useWorkspace } from "../../hooks/useWorkspace";
import { PageHeader } from "../../components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { ConnectedAccountsCard } from "./ConnectedAccountsCard";

/** Reason codes the API redirects back with — see integrations.controller.ts. */
const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Google connection cancelled.",
  GOOGLE_INTEGRATION_DISABLED: "Google integration is not set up for this environment.",
  INVALID_OAUTH_STATE: "That connection request expired. Please try again.",
  NO_REFRESH_TOKEN: "Google didn't grant offline access. Please try again and accept all permissions.",
  NO_ID_TOKEN: "Google didn't confirm an account identity. Please try again.",
  NO_GOOGLE_EMAIL: "Google didn't share an account email. Please try again.",
};

export function Settings() {
  const { user } = useAuth();
  const { activeStartup } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();

  // The Google OAuth callback redirects here with the outcome — surface it
  // once, then drop the query params so a refresh doesn't repeat the toast.
  useEffect(() => {
    const integration = searchParams.get("integration");
    if (!integration) return;

    if (integration === "connected") {
      toast.success("Google account connected");
    } else if (integration === "error") {
      const reason = searchParams.get("reason");
      toast.error(
        (reason && CONNECT_ERROR_MESSAGES[reason]) ?? "Could not connect your Google account",
      );
    }

    const next = new URLSearchParams(searchParams);
    next.delete("integration");
    next.delete("reason");
    setSearchParams(next, { replace: true });
    // Only meant to run once per landing, keyed off the params themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your account settings." />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Name</span>
            <span>{user ? `${user.firstName} ${user.lastName}`.trim() : "Account"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Email</span>
            <span>{user?.email}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Workspace</span>
            <span>{activeStartup?.name ?? "—"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Role</span>
            <span className="capitalize">{activeStartup?.member.role ?? "—"}</span>
          </div>
        </CardContent>
      </Card>

      <ConnectedAccountsCard />
    </div>
  );
}
