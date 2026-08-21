import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BarChart3, ChevronRight, Loader2, RotateCcw, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { AiAnalysisResult } from "../../../components/shared/AiAnalysisResult";
import { Button } from "../../../components/ui/button";
import { apiErrorMessage } from "../../../lib/api-error";
import { cancelAiAnalysis, createAiAnalysis, getAiAnalysis, type AiAnalysis } from "../../../lib/ai-api";

type Props = {
  startupId: string;
  sessionId: string;
  analysis: AiAnalysis;
  documentTitle: string;
  canCreate: boolean;
  onAskFollowup: (prompt: string) => void;
  onSelectPersona: (personaId: string | null) => void;
  selectedPersonaId: string | null;
};

export function AnalysisCard({ startupId, sessionId, analysis, documentTitle, canCreate, onAskFollowup, onSelectPersona, selectedPersonaId }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ["ai-analyses-session", startupId, sessionId];
  const retryMutation = useMutation({
    mutationFn: () => createAiAnalysis(startupId, { documentVersionId: analysis.documentVersionId, sessionId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      toast.success("Deck analysis queued");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not queue deck analysis")),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelAiAnalysis(startupId, analysis.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast.error(apiErrorMessage(error, "Could not cancel analysis")),
  });

  return (
    <article className="group flex gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <BarChart3 className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 max-w-[calc(100%-2.5rem)] flex-1 rounded-xl border border-border/60 bg-card/60 p-4">
        <p className="text-base font-semibold text-foreground">Deck analysis</p>
        <p className="truncate text-sm text-muted-foreground">{documentTitle}</p>

        {analysis.status === "queued" || analysis.status === "processing" ? (
          <div className="mt-3 rounded-lg border border-border/60 bg-surface/50 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> {analysis.status === "queued" ? "Analysis queued" : "Analyzing deck"}
            </div>
            <p className="mt-1 text-muted-foreground">This will update automatically.</p>
            <Button className="mt-2 h-7 px-2 text-xs" size="sm" variant="ghost" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              <X className="h-3 w-3" /> Cancel
            </Button>
          </div>
        ) : analysis.status === "failed" || analysis.status === "cancelled" ? (
          <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {analysis.status === "cancelled" ? "Analysis cancelled" : "Analysis failed"}
            </div>
            {analysis.errorMessage && <p className="mt-1 text-muted-foreground">{analysis.errorMessage}</p>}
            <Button className="mt-2 h-7 px-2 text-xs" size="sm" variant="outline" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending || !canCreate}>
              <RotateCcw className="h-3 w-3" /> Run again
            </Button>
          </div>
        ) : (
          <CompletedAnalysis startupId={startupId} analysis={analysis} canCreate={canCreate} onAskFollowup={onAskFollowup} onSelectPersona={onSelectPersona} selectedPersonaId={selectedPersonaId} />
        )}
      </div>
    </article>
  );
}

function CompletedAnalysis({ startupId, analysis, onAskFollowup, onSelectPersona, selectedPersonaId, canCreate }: { startupId: string; analysis: AiAnalysis; onAskFollowup: (prompt: string) => void; onSelectPersona: (personaId: string | null) => void; selectedPersonaId: string | null; canCreate: boolean }) {
  const detailQuery = useQuery({ queryKey: ["ai-analysis", startupId, analysis.id], queryFn: () => getAiAnalysis(startupId, analysis.id) });

  return (
    <div className="mt-3 space-y-4">
      <AiAnalysisResult analysis={analysis} />

      {detailQuery.data?.personas?.length ? (
        <details className="group rounded-xl border border-border/60 text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-medium text-foreground marker:content-none">
            <span>Investor rehearsal</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>
          <div className="border-t border-border/60 px-3 py-3">
            <p className="text-muted-foreground">These are AI-generated simulations, not real investors.</p>
            <div className="mt-2 space-y-2">
              {detailQuery.data.personas.map((persona) => (
                <div key={persona.id} className="rounded-lg border border-border/60 bg-surface/40 p-2.5">
                  <p className="font-medium text-foreground">{persona.personaName ?? "Investor persona"}</p>
                  <p className="mt-1 text-muted-foreground line-clamp-2">{persona.description}</p>
                  {persona.questions.length > 0 && (
                    <details className="mt-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer font-medium">Sample questions ({persona.questions.length})</summary>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4">
                        {persona.questions.map((question) => (
                          <li key={question.id}>{question.questionText}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <Button
                    className="mt-2 h-7 px-2 text-xs"
                    size="sm"
                    variant={selectedPersonaId === persona.id ? "secondary" : "outline"}
                    onClick={() => onSelectPersona(selectedPersonaId === persona.id ? null : persona.id)}
                    disabled={!canCreate}
                  >
                    <UserRound className="h-3 w-3" /> {selectedPersonaId === persona.id ? "Stop simulation" : "Rehearse with this persona"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </details>
      ) : null}

      <Button className="w-full" size="sm" variant="outline" onClick={() => onAskFollowup("Explain the highest-priority gap in this deck analysis and suggest a concrete revision.")}>
        Ask about this analysis
      </Button>
    </div>
  );
}
