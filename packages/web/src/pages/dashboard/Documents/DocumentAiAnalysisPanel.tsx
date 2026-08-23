import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, ChevronRight, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { AiAnalysisResult } from "../../../components/shared/AiAnalysisResult";
import { EmptyState } from "../../../components/shared/EmptyState";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { apiErrorMessage } from "../../../lib/api-error";
import { cancelAiAnalysis, createAiAnalysis, listAiAnalyses, type AiAnalysis } from "../../../lib/ai-api";
import { cn } from "../../../lib/utils";

type Props = {
  startupId: string;
  documentVersionId: string | null;
  canReadAnalyses: boolean;
  canCreateAnalysis: boolean;
};

/**
 * The persistent home for a document's AI deck analysis — previously this
 * only ever existed inline in an AI Copilot conversation, so closing or
 * losing track of that chat meant losing easy access to the results even
 * though they're stored per document version, not per conversation.
 */
export function DocumentAiAnalysisPanel({ startupId, documentVersionId, canReadAnalyses, canCreateAnalysis }: Props) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryKey = ["ai-analyses", startupId, "document-version", documentVersionId];

  const analysesQuery = useQuery({
    queryKey,
    queryFn: () => listAiAnalyses(startupId, { documentVersionId: documentVersionId as string }),
    enabled: canReadAnalyses && Boolean(documentVersionId),
    refetchInterval: (query) => (query.state.data?.some((a) => a.status === "queued" || a.status === "processing") ? 2_500 : false),
  });

  const createMutation = useMutation({
    mutationFn: () => createAiAnalysis(startupId, { documentVersionId: documentVersionId as string }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      toast.success("Deck analysis queued");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not queue deck analysis")),
  });

  const cancelMutation = useMutation({
    mutationFn: (analysisId: string) => cancelAiAnalysis(startupId, analysisId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast.error(apiErrorMessage(error, "Could not cancel analysis")),
  });

  if (!canReadAnalyses) {
    return <p className="py-8 text-center text-sm text-muted-foreground">You do not have access to AI analysis for this document.</p>;
  }
  if (!documentVersionId) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Upload a version of this document before it can be analyzed.</p>;
  }
  if (analysesQuery.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (analysesQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
        <AlertCircle className="h-5 w-5" />
        {apiErrorMessage(analysesQuery.error, "Could not load AI analyses.")}
        <Button size="sm" variant="outline" onClick={() => void analysesQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const analyses = analysesQuery.data ?? [];
  if (!analyses.length) {
    return (
      <div className="rounded-lg border border-dashed border-border/70">
        <EmptyState
          compact
          icon={Sparkles}
          title="No AI analysis yet"
          description="Run a deck analysis to get scores, strengths, gaps, and simulated investor personas for this document."
          action={
            canCreateAnalysis ? (
              <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Analyze this document
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const active = analyses.find((a) => a.id === selectedId) ?? analyses[0];
  const previous = analyses.filter((a) => a.id !== active.id);

  return (
    <div className="space-y-4">
      {active.status === "queued" || active.status === "processing" ? (
        <div className="rounded-lg border border-border/60 bg-surface/50 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> {active.status === "queued" ? "Analysis queued" : "Analyzing deck"}
          </div>
          <p className="mt-1 text-muted-foreground">This will update automatically.</p>
          <Button className="mt-2 h-7 px-2 text-xs" size="sm" variant="ghost" onClick={() => cancelMutation.mutate(active.id)} disabled={cancelMutation.isPending}>
            <X className="h-3 w-3" /> Cancel
          </Button>
        </div>
      ) : active.status === "failed" || active.status === "cancelled" ? (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> {active.status === "cancelled" ? "Analysis cancelled" : "Analysis failed"}
          </div>
          {active.errorMessage && <p className="mt-1 text-muted-foreground">{active.errorMessage}</p>}
          {canCreateAnalysis && (
            <Button className="mt-2 h-7 px-2 text-xs" size="sm" variant="outline" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              <RotateCcw className="h-3 w-3" /> Run again
            </Button>
          )}
        </div>
      ) : (
        <>
          <AiAnalysisResult analysis={active} />
          <AnalysisPersonas analysis={active} />
        </>
      )}

      {canCreateAnalysis && active.status !== "queued" && active.status !== "processing" && (
        <Button size="sm" variant="outline" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
          {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Re-analyze
        </Button>
      )}

      {previous.length > 0 && (
        <details className="group rounded-xl border border-border/60 text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-medium text-foreground marker:content-none">
            <span>{previous.length} earlier {previous.length === 1 ? "analysis" : "analyses"}</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>
          <ul className="space-y-1 border-t border-border/60 px-3 py-2">
            {previous.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                >
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                  <span className={cn("capitalize", item.status === "failed" && "text-destructive")}>
                    {item.status === "completed" ? `Score ${item.overallScore ?? "—"}` : item.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function AnalysisPersonas({ analysis }: { analysis: AiAnalysis }) {
  const personas = analysis.result?.personas ?? [];
  if (!personas.length) return null;

  return (
    <details className="group rounded-xl border border-border/60 text-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-medium text-foreground marker:content-none">
        <span>Investor personas</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-2 border-t border-border/60 px-3 py-3">
        <p className="text-xs text-muted-foreground">These are AI-generated simulations, not real investors. Open a Copilot conversation to rehearse with one.</p>
        {personas.map((persona, index) => (
          <div key={index} className="rounded-lg border border-border/60 bg-surface/40 p-3">
            <p className="font-medium text-foreground">{persona.name}</p>
            <p className="mt-1 text-muted-foreground">{persona.investmentLens}</p>
            {persona.whyTheyCare && <p className="mt-1 text-muted-foreground">{persona.whyTheyCare}</p>}
            {persona.likelyObjections?.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Likely objections</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-foreground/80">
                  {persona.likelyObjections.map((objection, i) => (
                    <li key={i}>{objection}</li>
                  ))}
                </ul>
              </div>
            )}
            {persona.questions?.length > 0 && (
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium">Sample questions ({persona.questions.length})</summary>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  {persona.questions.map((question, i) => (
                    <li key={i}>{question}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
