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
  | { kind: "requires_login"; email: string }
  | { kind: "requires_registration"; email: string }
  | { kind: "email_mismatch"; invitedEmail: string; signedInAs: string }
  | { kind: "already_accepted" }
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "error"; message: string };

function toErrorScreen(err: unknown): Screen {
  if (isAxiosError(err)) {
    const data = err.response?.data as
      | { code?: string; error?: string; invitedEmail?: string; signedInAs?: string }
      | undefined;

    switch (data?.code) {
      case "TOKEN_EXPIRED":
        return { kind: "expired" };
      case "ALREADY_ACCEPTED":
        return { kind: "already_accepted" };
      case "INVALID_TOKEN":
        return { kind: "invalid" };
      case "EMAIL_MISMATCH":
        return {
          kind: "email_mismatch",
          invitedEmail: data.invitedEmail ?? "another address",
          signedInAs: data.signedInAs ?? "this account",
        };
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

  // Sign-in and registration both come back here so the invitation can finish
  // in one pass instead of stranding the user on the dashboard.
  const returnTo = `/accept-invite?token=${encodeURIComponent(token)}`;
  const loginHref = (email: string) =>
    `/auth/login?next=${encodeURIComponent(returnTo)}&email=${encodeURIComponent(email)}`;
  // Registration claims a matching pending invite on email verification, so it
  // lands in the workspace on its own — there is nothing to come back for.
  const registerHref = (email: string) => `/auth/register?email=${encodeURIComponent(email)}`;

  useEffect(() => {
    // Wait for the session probe: the server decides what to do based on who
    // is signed in, so asking before the cookie is settled gets the wrong answer.
    if (!token || isAuthLoading || requestedRef.current) return;

    // StrictMode runs effects twice in dev. Accepting is idempotent server-side
    // now, but there is still no reason to send the request twice.
    requestedRef.current = true;

    acceptInvite(token)
      .then((result) => {
        if (result.status === "requires_registration") {
          setScreen({ kind: "requires_registration", email: result.email });
          return;
        }

        if (result.status === "requires_login") {
          setScreen({ kind: "requires_login", email: result.email });
          return;
        }

        // The server only ever returns a membership that belongs to the
        // signed-in user, so adopting the workspace here is safe.
        setActiveStartupId(result.member.startupId);
        setScreen({ kind: "accepted" });
      })
      .catch((err) => setScreen(toErrorScreen(err)));
  }, [token, isAuthLoading, setActiveStartupId]);

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
          <Button asChild className="w-full">
            <Link to="/dashboard">Go to dashboard</Link>
          </Button>
        </Panel>
      );

    case "requires_login":
      return (
        <Panel
          title="Sign in to accept"
          description={
            <>
              This invitation was sent to{" "}
              <strong className="font-medium text-foreground">{screen.email}</strong>. Sign in with
              that account and we'll finish adding you to the workspace.
            </>
          }
        >
          <Button asChild className="w-full">
            <Link to={loginHref(screen.email)}>Sign in</Link>
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
            <Link to={registerHref(screen.email)}>Create account</Link>
          </Button>
        </Panel>
      );

    case "email_mismatch":
      return (
        <Panel
          title="This invitation isn't for this account"
          description={
            <>
              It was sent to{" "}
              <strong className="font-medium text-foreground">{screen.invitedEmail}</strong>, but
              you're signed in as{" "}
              <strong className="font-medium text-foreground">{screen.signedInAs}</strong>. The
              invitation is still waiting — sign in as the invited person to accept it.
            </>
          }
        >
          <Button asChild className="w-full">
            <Link to={loginHref(screen.invitedEmail)}>Switch account</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </Panel>
      );

    case "already_accepted":
      return (
        <Panel
          title="Already accepted"
          description="This invitation has already been used by the person it was sent to."
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
