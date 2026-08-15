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
} from "../../lib/startup-api";

type StartupForm = CreateStartupInput;

const fundingStages: Array<{ value: FundingStage; label: string }> = [
  { value: "pre_seed", label: "Pre-seed" },
  { value: "seed", label: "Seed" },
  { value: "series_a", label: "Series A" },
  { value: "series_b", label: "Series B" },
  { value: "series_c", label: "Series C" },
];

function toForm(startup: {
  name: string;
  description: string | null;
  industry: string | null;
  website: string | null;
  fundingStage: FundingStage;
}): StartupForm {
  return {
    name: startup.name,
    description: startup.description ?? "",
    industry: startup.industry ?? "",
    website: startup.website ?? "",
    funding_stage: startup.fundingStage,
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
    mutationFn: (input: StartupForm) => updateStartup(startupId, input),
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
