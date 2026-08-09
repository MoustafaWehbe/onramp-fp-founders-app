import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { useWorkspace, MY_STARTUPS_KEY } from "../../hooks/useWorkspace";
import { apiErrorMessage } from "../../lib/api-error";
import { createStartup, type FundingStage } from "../../lib/startup-api";

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

export function CreateStartup() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { startups, setActiveStartupId } = useWorkspace();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [fundingStage, setFundingStage] = useState<FundingStage>("pre_seed");

  const isFirstWorkspace = startups.length === 0;
  const selectedStage = FUNDING_STAGES.find((s) => s.id === fundingStage)!;

  const mutation = useMutation({
    mutationFn: () =>
      createStartup({
        name: name.trim(),
        description: description.trim(),
        industry: industry.trim(),
        website: website.trim(),
        funding_stage: fundingStage,
      }),
    onSuccess: async ({ startup }) => {
      // Open the new workspace rather than whatever was preferred before.
      setActiveStartupId(startup.id);
      await queryClient.invalidateQueries({ queryKey: MY_STARTUPS_KEY });
      toast.success(`${startup.name} is ready`);
      navigate("/dashboard", { replace: true });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create the startup")),
  });

  const websiteLooksValid = website.trim() === "" || /^https?:\/\/\S+\.\S+/i.test(website.trim());
  const canSubmit =
    name.trim() !== "" &&
    description.trim() !== "" &&
    industry.trim() !== "" &&
    website.trim() !== "" &&
    websiteLooksValid &&
    !mutation.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    mutation.mutate();
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Rocket className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {isFirstWorkspace ? "Create your startup" : "Create another startup"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFirstWorkspace
                ? "Your account is ready — this is the workspace your pipeline, investors and team will live in."
                : "You'll be switched into the new workspace once it's created."}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card-elevated space-y-5 p-5 sm:p-6">
          <div className="space-y-2">
            <Label htmlFor="startup-name">Startup name</Label>
            <Input
              id="startup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={LIMITS.name}
              placeholder="Acme Inc."
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="startup-description">What are you building?</Label>
            <Textarea
              id="startup-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={LIMITS.description}
              rows={3}
              placeholder="One or two lines an investor would understand."
              required
            />
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              {description.length}/{LIMITS.description}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startup-industry">Industry</Label>
              <Input
                id="startup-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                maxLength={LIMITS.industry}
                placeholder="Fintech"
                required
              />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Funding stage</div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full justify-between px-3 font-normal"
                  >
                    {selectedStage.label}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-[var(--radix-dropdown-menu-trigger-width)]"
                >
                  {FUNDING_STAGES.map((stage) => (
                    <DropdownMenuItem key={stage.id} onSelect={() => setFundingStage(stage.id)}>
                      {stage.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="startup-website">Website</Label>
            <Input
              id="startup-website"
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://acme.com"
              required
            />
            {website.trim() !== "" && !websiteLooksValid && (
              <p className="text-xs text-destructive">
                Include the full address, starting with http:// or https://
              </p>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            {!isFirstWorkspace && (
              <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending ? "Creating…" : "Create startup"}
            </Button>
          </div>
        </form>

        {isFirstWorkspace && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Waiting on a teammate's invitation instead? Open the link from your email — or{" "}
            <Link to="/auth/login" className="text-primary hover:underline">
              sign in as someone else
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
