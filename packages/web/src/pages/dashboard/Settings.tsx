import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Bell, PlugZap, Settings2, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ConnectedAccountsCard } from "./ConnectedAccountsCard";

const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Google connection cancelled.",
  GOOGLE_INTEGRATION_DISABLED: "Google integration is not set up for this environment.",
  INVALID_OAUTH_STATE: "That connection request expired. Please try again.",
  NO_REFRESH_TOKEN: "Google didn't grant offline access. Please try again and accept all permissions.",
  NO_ID_TOKEN: "Google didn't confirm an account identity. Please try again.",
  NO_GOOGLE_EMAIL: "Google didn't share an account email. Please try again.",
};

export function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const integration = searchParams.get("integration");
    if (!integration) return;

    if (integration === "connected") toast.success("Google account connected");
    else if (integration === "error") {
      const reason = searchParams.get("reason");
      toast.error((reason && CONNECT_ERROR_MESSAGES[reason]) ?? "Could not connect your Google account");
    }

    const next = new URLSearchParams(searchParams);
    next.delete("integration");
    next.delete("reason");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Settings" description="Tune your account experience and connected services." />

      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 sm:p-8">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative max-w-2xl">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><Settings2 className="h-5 w-5" /></div>
          <h2 className="font-display text-xl font-semibold sm:text-2xl">Your workspace, set up your way</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Keep your identity current, connect the tools you use, and stay in control of your account.</p>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="group border-border/70 transition-colors hover:border-primary/30">
          <CardContent className="flex h-full items-start gap-4 p-5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><UserRound className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display font-semibold">Personal profile</h3>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">Update your name and profile photo.</p>
              <Button asChild variant="link" className="mt-3 h-auto p-0 text-primary"><Link to="/profile">Manage profile <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" /></Link></Button>
            </div>
          </CardContent>
        </Card>

        <Card className="group border-border/70 transition-colors hover:border-primary/30">
          <CardContent className="flex h-full items-start gap-4 p-5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Bell className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display font-semibold">Notifications</h3>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">Review updates, invitations, and activity.</p>
              <Button asChild variant="link" className="mt-3 h-auto p-0 text-primary"><Link to="/notifications">View notifications <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" /></Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3 px-1">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><PlugZap className="h-4 w-4" /></div>
          <div><h2 className="font-display font-semibold">Connected services</h2><p className="text-sm text-muted-foreground">Bring email and calendar activity into your fundraising workflow.</p></div>
        </div>
        <ConnectedAccountsCard />
      </div>

      <Card className="border-border/70 bg-muted/15">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" /> Security and privacy</CardTitle>
          <CardDescription>Authentication cookies are HttpOnly and connected-account credentials are never exposed to the browser.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
