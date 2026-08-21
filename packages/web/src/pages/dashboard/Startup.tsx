import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Save } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../../components/shared/EmptyState";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Skeleton } from "../../components/ui/skeleton";
import { Textarea } from "../../components/ui/textarea";
import { usePermissions } from "../../hooks/usePermissions";
import { useActiveStartupId } from "../../hooks/useWorkspace";
import { apiErrorMessage } from "../../lib/api-error";
import {
  getStartup,
  updateStartup,
  type CreateStartupInput,
  type FundingStage,
  type Startup as StartupRecord,
  type UpdateStartupInput,
} from "../../lib/startup-api";

type StartupForm = CreateStartupInput & {
  oneLiner: string;
  problemStatement: string;
  solutionSummary: string;
  targetMarket: string;
  businessModel: string;
  tractionSummary: string;
  competitiveEdge: string;
  headquarters: string;
  foundedAt: string;
  teamSummary: string;
};

const fundingStages: Array<{ value: FundingStage; label: string }> = [
  { value: "pre_seed", label: "Pre-seed" },
  { value: "seed", label: "Seed" },
  { value: "series_a", label: "Series A" },
  { value: "series_b", label: "Series B" },
  { value: "series_c", label: "Series C" },
];

function toForm(startup: StartupRecord): StartupForm {
  return {
    name: startup.name,
    description: startup.description ?? "",
    industry: startup.industry ?? "",
    website: startup.website ?? "",
    funding_stage: startup.fundingStage,
    oneLiner: startup.oneLiner ?? "",
    problemStatement: startup.problemStatement ?? "",
    solutionSummary: startup.solutionSummary ?? "",
    targetMarket: startup.targetMarket ?? "",
    businessModel: startup.businessModel ?? "",
    tractionSummary: startup.tractionSummary ?? "",
    competitiveEdge: startup.competitiveEdge ?? "",
    headquarters: startup.headquarters ?? "",
    // A date input needs YYYY-MM-DD; foundedAt round-trips as a full ISO timestamp.
    foundedAt: startup.foundedAt ? startup.foundedAt.slice(0, 10) : "",
    teamSummary: startup.teamSummary ?? "",
  };
}

// Blank optional fields are sent as null rather than "" so that clearing a
// value actually clears it server-side instead of being rejected or ignored.
function toInput(form: StartupForm): UpdateStartupInput {
  const orNull = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    name: form.name,
    description: form.description,
    industry: form.industry,
    website: form.website,
    funding_stage: form.funding_stage,
    oneLiner: orNull(form.oneLiner),
    problemStatement: orNull(form.problemStatement),
    solutionSummary: orNull(form.solutionSummary),
    targetMarket: orNull(form.targetMarket),
    businessModel: orNull(form.businessModel),
    tractionSummary: orNull(form.tractionSummary),
    competitiveEdge: orNull(form.competitiveEdge),
    headquarters: orNull(form.headquarters),
    foundedAt: form.foundedAt.trim() === "" ? null : new Date(form.foundedAt).toISOString(),
    teamSummary: orNull(form.teamSummary),
  };
}

export function Startup() {
  const startupId = useActiveStartupId();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<StartupForm | null>(null);

  const startupQuery = useQuery({
    queryKey: ["startup", startupId],
    queryFn: () => getStartup(startupId),
  });

  useEffect(() => {
    if (startupQuery.data?.startup) setForm(toForm(startupQuery.data.startup));
  }, [startupQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: StartupForm) => updateStartup(startupId, toInput(input)),
    onSuccess: (startup) => {
      setForm(toForm(startup));
      void queryClient.invalidateQueries({ queryKey: ["startup", startupId] });
      void queryClient.invalidateQueries({ queryKey: ["my-startups"] });
      toast.success("Startup details saved");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not save startup details")),
  });

  if (startupQuery.isPending || !form) return <StartupSkeleton />;

  if (startupQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Startup" description="Public and internal details for this startup workspace." />
        <div className="card-elevated">
          <EmptyState
            icon={Building2}
            title="Could not load startup details"
            description={apiErrorMessage(startupQuery.error, "Please try again.")}
            action={<Button onClick={() => void startupQuery.refetch()}>Retry</Button>}
          />
        </div>
      </div>
    );
  }

  const canEdit = can("startup", "update");
  const updateField = (name: keyof StartupForm, value: string) =>
    setForm((current) => (current ? { ...current, [name]: value } : current));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Startup"
        description="Public and internal details for this startup workspace."
      />

      <div className="card-elevated max-w-3xl p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name" name="name" value={form.name} disabled={!canEdit} onChange={(value) => updateField("name", value)} />
          <Field label="Website" name="website" value={form.website} disabled={!canEdit} onChange={(value) => updateField("website", value)} />
          <Field label="Industry" name="industry" value={form.industry} disabled={!canEdit} onChange={(value) => updateField("industry", value)} />
          <div>
            <Label htmlFor="funding-stage" className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground">
              Funding stage
            </Label>
            <select
              id="funding-stage"
              value={form.funding_stage}
              disabled={!canEdit}
              onChange={(event) => updateField("funding_stage", event.target.value)}
              className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {fundingStages.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="description" className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground">
              Description
            </Label>
            <Textarea
              id="description"
              rows={4}
              value={form.description}
              disabled={!canEdit}
              onChange={(event) => updateField("description", event.target.value)}
              className="border-border bg-surface"
            />
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-sm font-semibold">AI copilot profile</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Structured comparables the copilot reads to judge investor and pitch fit. All optional.
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label="One-liner" name="oneLiner" value={form.oneLiner} disabled={!canEdit} onChange={(value) => updateField("oneLiner", value)} />
            <Field label="Headquarters" name="headquarters" value={form.headquarters} disabled={!canEdit} onChange={(value) => updateField("headquarters", value)} />
            <div>
              <Label htmlFor="foundedAt" className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground">Founded</Label>
              <Input id="foundedAt" type="date" value={form.foundedAt} disabled={!canEdit} onChange={(event) => updateField("foundedAt", event.target.value)} className="border-border bg-surface" />
            </div>
            <Field label="Target market" name="targetMarket" value={form.targetMarket} disabled={!canEdit} onChange={(value) => updateField("targetMarket", value)} />
            {([
              ["problemStatement", "Problem statement"],
              ["solutionSummary", "Solution summary"],
              ["businessModel", "Business model"],
              ["tractionSummary", "Traction summary"],
              ["competitiveEdge", "Competitive edge"],
              ["teamSummary", "Team summary"],
            ] as const).map(([name, label]) => (
              <div key={name} className="sm:col-span-2">
                <Label htmlFor={name} className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground">{label}</Label>
                <Textarea id={name} rows={3} value={form[name]} disabled={!canEdit} onChange={(event) => updateField(name, event.target.value)} className="border-border bg-surface" />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-5">
          <Button variant="ghost" size="sm" onClick={() => setForm(toForm(startupQuery.data.startup))} disabled={!canEdit || saveMutation.isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => saveMutation.mutate(form)} disabled={!canEdit || saveMutation.isPending}>
            <Save className="mr-1.5 h-4 w-4" />
            {saveMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
        {!canEdit && <p className="mt-3 text-xs text-muted-foreground">You have read-only access to these startup details.</p>}
      </div>
    </div>
  );
}

function Field({ label, name, value, disabled, onChange }: {
  label: string; name: string; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label htmlFor={name} className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground">{label}</Label>
      <Input id={name} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="border-border bg-surface" />
    </div>
  );
}

function StartupSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader title="Startup" description="Public and internal details for this startup workspace." />
      <div className="card-elevated max-w-3xl space-y-5 p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-10 w-full" /></div>)}
        </div>
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}
