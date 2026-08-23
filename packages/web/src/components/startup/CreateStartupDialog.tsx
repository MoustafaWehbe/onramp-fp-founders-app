import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { useWorkspace, MY_STARTUPS_KEY } from "../../hooks/useWorkspace";
import { apiErrorMessage } from "../../lib/api-error";
import { INDUSTRY_OPTIONS, selectOptions } from "../../lib/form-options";
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
const LIMITS = { name: 100, description: 500 };

type CreateStartupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Creating a workspace is a step inside the app, not a place you get sent to.
 * Someone with no startup can dismiss this and sit on an empty dashboard until
 * an invitation arrives so nothing here may trap them.
 */
export function CreateStartupDialog({ open, onOpenChange }: CreateStartupDialogProps) {
  const queryClient = useQueryClient();
  const { startups, setActiveStartupId } = useWorkspace();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [fundingStage, setFundingStage] = useState<FundingStage>("pre_seed");

  const isFirstWorkspace = startups.length === 0;
  // A dismissed half-filled form should not greet them on the way back in.
  useEffect(() => {
    if (open) return;
    setName("");
    setDescription("");
    setIndustry("");
    setWebsite("");
    setFundingStage("pre_seed");
  }, [open]);

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
      onOpenChange(false);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isFirstWorkspace ? "Create your startup" : "Create another startup"}
          </DialogTitle>
          <DialogDescription>
            {isFirstWorkspace
              ? "This is the workspace your pipeline, investors and team will live in."
              : "You'll be switched into the new workspace once it's created."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
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
              <Select
                id="startup-industry"
                value={industry}
                onValueChange={setIndustry}
                options={selectOptions(INDUSTRY_OPTIONS)}
                placeholder="Select industry"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="startup-funding-stage">Funding stage</Label>
              <Select
                id="startup-funding-stage"
                value={fundingStage}
                onValueChange={(value) => setFundingStage(value as FundingStage)}
                options={FUNDING_STAGES.map((stage) => ({ value: stage.id, label: stage.label }))}
              />
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

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {isFirstWorkspace ? "Skip for now" : "Cancel"}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending ? "Creating…" : "Create startup"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
