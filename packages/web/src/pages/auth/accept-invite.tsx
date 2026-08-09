import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { isAxiosError } from "axios";
import { Button } from "../../components/ui/button";
import { useAuth } from "../../hooks/useAuth";
import { useAppStore } from "../../lib/app-store";
import { acceptInvite } from "../../lib/invite-api";

type Screen =
  | { kind: "loading" }
  | { kind: "accepted" }
  | { kind: "accepted_other_account" }
  | { kind: "requires_registration"; email: string }
  | { kind: "already_accepted" }
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "error"; message: string };

function toErrorScreen(err: unknown): Screen {
  if (isAxiosError(err)) {
    const data = err.response?.data as { code?: string; error?: string } | undefined;

    switch (data?.code) {
      case "TOKEN_EXPIRED":
        return { kind: "expired" };
      case "ALREADY_ACCEPTED":
        return { kind: "already_accepted" };
      case "INVALID_TOKEN":
        return { kind: "invalid" };
    }

    return {
      kind: "error",
      message: data?.error ?? "We couldn't process this invitation.",
    };
  }

  return { kind: "error", message: "We couldn't process this invitation." };
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {children && <div className="mt-6 space-y-3">{children}</div>}
    </div>
  );
}

function AcceptInvite() {
  // Read the token off the URL directly rather than via useSearchParams — the
  // token is only ever consumed once, on mount, and this keeps it out of the
  // effect's dependency list.
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const { user, isLoading: isAuthLoading } = useAuth();
  const setActiveStartupId = useAppStore((s) => s.setActiveStartupId);

  const [screen, setScreen] = useState<Screen>(() =>
    token ? { kind: "loading" } : { kind: "invalid" },
  );
  const requestedRef = useRef(false);

  useEffect(() => {
    // Wait for the session probe: whether the accepted membership belongs to
    // the signed-in user decides which screen we show.
    if (!token || isAuthLoading || requestedRef.current) return;

    // StrictMode runs effects twice in dev and the token is single-use — the
    // second call would come back as ALREADY_ACCEPTED and mask the real result.
    requestedRef.current = true;

    acceptInvite(token)
      .then((result) => {
        if (result.status === "requires_registration") {
          setScreen({ kind: "requires_registration", email: result.email });
          return;
        }

        // The endpoint activates the membership for whoever owns the invited
        // email, not for whoever opened the link. Only adopt the workspace when
        // it actually belongs to the signed-in account.
        if (user && result.member.userId !== user.id) {
          setScreen({ kind: "accepted_other_account" });
          return;
        }

        setActiveStartupId(result.member.startupId);
        setScreen({ kind: "accepted" });
      })
      .catch((err) => setScreen(toErrorScreen(err)));
  }, [token, isAuthLoading, user, setActiveStartupId]);

  switch (screen.kind) {
    case "loading":
      return (
        <Panel title="Accepting your invitation" description="One moment while we add you to the workspace…" />
      );

    case "accepted":
      return (
        <Panel
          title="You're in"
          description="Your invitation has been accepted and you now have access to the workspace."
        >
          {user ? (
            <Button asChild className="w-full">
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          ) : (
            <Button asChild className="w-full">
              <Link to="/auth/login">Sign in to continue</Link>
            </Button>
          )}
        </Panel>
      );

    case "accepted_other_account":
      return (
        <Panel
          title="Invitation belongs to another account"
          description="This invitation was issued to a different email address than the one you're signed in with. Sign out and sign back in as the invited person to access the workspace."
        >
          <Button asChild variant="outline" className="w-full">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </Panel>
      );

    case "requires_registration":
      return (
        <Panel
          title="Create your account"
          description={
            <>
              You've been invited as{" "}
              <strong className="font-medium text-foreground">{screen.email}</strong>. Create an
              account with that address and you'll join the workspace automatically.
            </>
          }
        >
          <Button asChild className="w-full">
            <Link to={`/auth/register?email=${encodeURIComponent(screen.email)}`}>
              Create account
            </Link>
          </Button>
        </Panel>
      );

    case "already_accepted":
      return (
        <Panel
          title="Already accepted"
          description="This invitation has already been used. Sign in to reach the workspace."
        >
          <Button asChild className="w-full">
            <Link to={user ? "/dashboard" : "/auth/login"}>
              {user ? "Go to dashboard" : "Sign in"}
            </Link>
          </Button>
        </Panel>
      );

    case "expired":
      return (
        <Panel
          title="This invitation has expired"
          description="Invitations are valid for 7 days. Ask a workspace owner to send you a new one."
        >
          <Button asChild variant="outline" className="w-full">
            <Link to="/auth/login">Back to sign in</Link>
          </Button>
        </Panel>
      );

    case "invalid":
      return (
        <Panel
          title="Invalid invitation link"
          description="This link is missing or no longer valid. Ask a workspace owner to send you a new invitation."
        >
          <Button asChild variant="outline" className="w-full">
            <Link to="/auth/login">Back to sign in</Link>
          </Button>
        </Panel>
      );

    case "error":
      return (
        <Panel title="Something went wrong" description={screen.message}>
          <Button asChild variant="outline" className="w-full">
            <Link to="/auth/login">Back to sign in</Link>
          </Button>
        </Panel>
      );
  }
}

export { AcceptInvite };
