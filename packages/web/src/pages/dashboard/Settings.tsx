import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Bell, Building2, ChevronDown, PlugZap, Settings2, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { usePermissions } from "../../hooks/usePermissions";
import { useActiveStartupId, useWorkspace, MY_STARTUPS_KEY } from "../../hooks/useWorkspace";
import { apiErrorMessage } from "../../lib/api-error";
import { updateStartup, type FundingStage } from "../../lib/startup-api";
import { ConnectedAccountsCard } from "./ConnectedAccountsCard";

const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Google connection cancelled.",
  GOOGLE_INTEGRATION_DISABLED: "Google integration is not set up for this environment.",
  INVALID_OAUTH_STATE: "That connection request expired. Please try again.",
  NO_REFRESH_TOKEN: "Google didn't grant offline access. Please try again and accept all permissions.",
  NO_ID_TOKEN: "Google didn't confirm an account identity. Please try again.",
  NO_GOOGLE_EMAIL: "Google didn't share an account email. Please try again.",
};

/** Matches the funding_stage enum in packages/api/src/validators/startup.schemas.ts. */
const FUNDING_STAGES: { id: FundingStage; label: string }[] = [
  { id: "pre_seed", label: "Pre-seed" },
  { id: "seed", label: "Seed" },
  { id: "series_a", label: "Series A" },
  { id: "series_b", label: "Series B" },
  { id: "series_c", label: "Series C" },
];

// Mirrors the server-side zod rules so the first failure is inline rather than
// a toast after a round trip.
const LIMITS = { name: 100, description: 500, industry: 100 };

/** Common startup industries; "Other" falls back to free text since the server accepts any string. */
const INDUSTRIES = [
  "Fintech",
  "Healthtech",
  "SaaS / Enterprise Software",
  "AI / Machine Learning",
  "E-commerce",
  "Marketplace",
  "Consumer",
  "EdTech",
  "Cybersecurity",
  "Climate / CleanTech",
  "Biotech / Life Sciences",
  "Hardware",
  "Real Estate / PropTech",
  "Logistics / Supply Chain",
  "Gaming",
  "Media / Entertainment",
];

function CompanyProfileCard() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const startupId = useActiveStartupId();
  const { activeStartup } = useWorkspace();
  const canEdit = can("startup", "update");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryCustom, setIndustryCustom] = useState(false);
  const [website, setWebsite] = useState("");
  const [fundingStage, setFundingStage] = useState<FundingStage>("pre_seed");

  useEffect(() => {
    if (!activeStartup) return;
    setName(activeStartup.name);
    setDescription(activeStartup.description ?? "");
    setIndustry(activeStartup.industry ?? "");
    setIndustryCustom(activeStartup.industry ? !INDUSTRIES.includes(activeStartup.industry) : false);
    setWebsite(activeStartup.website ?? "");
    setFundingStage(activeStartup.fundingStage);
  }, [activeStartup]);

  if (!activeStartup) return null;

  const isDirty =
    name.trim() !== activeStartup.name ||
    description.trim() !== (activeStartup.description ?? "") ||
    industry.trim() !== (activeStartup.industry ?? "") ||
    website.trim() !== (activeStartup.website ?? "") ||
    fundingStage !== activeStartup.fundingStage;

  const websiteLooksValid = website.trim() === "" || /^https?:\/\/\S+\.\S+/i.test(website.trim());
  const selectedStage = FUNDING_STAGES.find((s) => s.id === fundingStage)!;

  const saveMutation = useMutation({
    mutationFn: () =>
      updateStartup(startupId, {
        name: name.trim(),
        description: description.trim(),
        industry: industry.trim(),
        website: website.trim(),
        funding_stage: fundingStage,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MY_STARTUPS_KEY });
      toast.success("Company profile updated");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update the company profile")),
  });

  const canSubmit =
    canEdit &&
    isDirty &&
    !saveMutation.isPending &&
    name.trim() !== "" &&
    industry.trim() !== "" &&
    websiteLooksValid;

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Building2 className="h-5 w-5 text-primary" /> Company profile
        </CardTitle>
        <CardDescription>
          {canEdit
            ? "What your team and investors see when they look up this workspace."
            : "Only the workspace owner can edit these details."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="startup-name">Startup name</Label>
          <Input
            id="startup-name"
            value={name}
            maxLength={LIMITS.name}
            disabled={!canEdit}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="startup-description">What are you building?</Label>
          <Textarea
            id="startup-description"
            value={description}
            maxLength={LIMITS.description}
            rows={3}
            disabled={!canEdit}
            placeholder="One or two lines an investor would understand."
            onChange={(e) => setDescription(e.target.value)}
          />
          {canEdit && (
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              {description.length}/{LIMITS.description}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="startup-industry">Industry</Label>
            {canEdit ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      id="startup-industry"
                      type="button"
                      variant="outline"
                      className="h-9 w-full justify-between px-3 font-normal"
                    >
                      <span className="truncate">
                        {industryCustom ? "Other" : industry || "Select industry"}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
                  >
                    {INDUSTRIES.map((option) => (
                      <DropdownMenuItem
                        key={option}
                        onSelect={() => {
                          setIndustry(option);
                          setIndustryCustom(false);
                        }}
                      >
                        {option}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        setIndustryCustom(true);
                        setIndustry((prev) => (INDUSTRIES.includes(prev) ? "" : prev));
                      }}
                    >
                      Other…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {industryCustom && (
                  <Input
                    id="startup-industry-custom"
                    value={industry}
                    maxLength={LIMITS.industry}
                    placeholder="Describe your industry"
                    autoFocus
                    onChange={(e) => setIndustry(e.target.value)}
                  />
                )}
              </>
            ) : (
              <Input id="startup-industry" value={industry} disabled />
            )}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Funding stage</div>
            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="h-9 w-full justify-between px-3 font-normal">
                    {selectedStage.label}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  {FUNDING_STAGES.map((stage) => (
                    <DropdownMenuItem key={stage.id} onSelect={() => setFundingStage(stage.id)}>
                      {stage.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Input value={selectedStage.label} disabled />
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="startup-website">Website</Label>
          <Input
            id="startup-website"
            type="url"
            value={website}
            disabled={!canEdit}
            placeholder="https://acme.com"
            onChange={(e) => setWebsite(e.target.value)}
          />
          {canEdit && website.trim() !== "" && !websiteLooksValid && (
            <p className="text-xs text-destructive">Include the full address, starting with http:// or https://</p>
          )}
        </div>

        {canEdit && (
          <div className="flex justify-end border-t border-border/60 pt-5">
            <Button type="button" disabled={!canSubmit} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
      <PageHeader title="Settings" description="Your account, your company profile, and the tools you've connected." />

      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 sm:p-8">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative max-w-2xl">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><Settings2 className="h-5 w-5" /></div>
          <h2 className="font-display text-xl font-semibold sm:text-2xl">Your workspace, set up your way</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Keep your identity current, connect the tools you use, and stay in control of your account.</p>
        </div>
      </section>

      <CompanyProfileCard />

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
