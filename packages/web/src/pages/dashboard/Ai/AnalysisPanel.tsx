import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BarChart3, FileSearch, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { apiErrorMessage } from "../../../lib/api-error";
import { cancelAiAnalysis, createAiAnalysis, listAiAnalyses, type AiAnalysis, type AiSession } from "../../../lib/ai-api";

type Props = { startupId: string; session: AiSession; canCreate: boolean; onAskFollowup: (prompt: string) => void };

export function AnalysisPanel({ startupId, session, canCreate, onAskFollowup }: Props) {
  const queryClient = useQueryClient();
  const document = session.documents?.[0];
  const queryKey = ["ai-analyses", startupId, document?.documentVersionId];
  const analysesQuery = useQuery({
    queryKey,
    queryFn: () => listAiAnalyses(startupId, document!.documentVersionId),
    enabled: Boolean(document),
    refetchInterval: (query) => query.state.data?.some((analysis) => analysis.status === "queued" || analysis.status === "processing") ? 2_500 : false,
  });
  const analyses = analysesQuery.data ?? [];
  const latest = analyses[0];
  const createMutation = useMutation({
    mutationFn: () => createAiAnalysis(startupId, { documentVersionId: document!.documentVersionId, sessionId: session.id }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); toast.success("Deck analysis queued"); },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not queue deck analysis")),
  });
  const cancelMutation = useMutation({
    mutationFn: (analysisId: string) => cancelAiAnalysis(startupId, analysisId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not cancel analysis")),
  });

  if (!document) return null;
  return <section className="mt-6 border-t pt-5"><div className="flex items-center gap-2 text-sm font-medium"><BarChart3 className="h-4 w-4 text-muted-foreground" /> Deck analysis</div><p className="mt-1 text-xs text-muted-foreground">Version {document.versionNumber} · rubric-backed feedback</p>{analysesQuery.isPending ? <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading analyses</div> : latest ? <AnalysisState analysis={latest} onRetry={() => createMutation.mutate()} onCancel={() => cancelMutation.mutate(latest.id)} pending={createMutation.isPending || cancelMutation.isPending} onAskFollowup={onAskFollowup} /> : <Button className="mt-3 w-full" size="sm" variant="outline" onClick={() => createMutation.mutate()} disabled={!canCreate || createMutation.isPending}>{createMutation.isPending ? <Loader2 className="animate-spin" /> : <FileSearch />} Analyze this deck</Button>}</section>;
}

function AnalysisState({ analysis, onRetry, onCancel, pending, onAskFollowup }: { analysis: AiAnalysis; onRetry: () => void; onCancel: () => void; pending: boolean; onAskFollowup: (prompt: string) => void }) {
  if (analysis.status === "queued" || analysis.status === "processing") return <div className="mt-3 rounded-md bg-muted p-3 text-xs"><div className="flex items-center gap-2 font-medium"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {analysis.status === "queued" ? "Analysis queued" : "Analyzing deck"}</div><p className="mt-1 text-muted-foreground">This page will update automatically.</p><Button className="mt-2" size="sm" variant="ghost" onClick={onCancel} disabled={pending}><X /> Cancel</Button></div>;
  if (analysis.status === "failed" || analysis.status === "cancelled") return <div className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-xs"><div className="flex items-center gap-2 font-medium text-destructive"><AlertCircle className="h-3.5 w-3.5" /> {analysis.status === "cancelled" ? "Analysis cancelled" : "Analysis failed"}</div>{analysis.errorMessage && <p className="mt-1 text-muted-foreground">{analysis.errorMessage}</p>}<Button className="mt-2" size="sm" variant="outline" onClick={onRetry} disabled={pending}><RotateCcw /> Run again</Button></div>;
  return <CompletedAnalysis analysis={analysis} onAskFollowup={onAskFollowup} />;
}

function CompletedAnalysis({ analysis, onAskFollowup }: { analysis: AiAnalysis; onAskFollowup: (prompt: string) => void }) {
  const result = analysis.result as { strengths?: Array<{ statement: string }>; gaps?: Array<{ section: string; severity: string; issue: string; recommendation: string; evidence: Array<{ label: string; excerpt: string }> }> } | null;
  const scores = [["Overall", analysis.overallScore], ["Narrative", analysis.narrativeScore], ["Market", analysis.marketValidationScore], ["Financial", analysis.financialScore]] as const;
  return <div className="mt-3 space-y-3"><div className="grid grid-cols-2 gap-2">{scores.map(([label, score]) => <div key={label} className="rounded-md border p-2"><div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 font-display text-lg font-semibold">{score ?? "—"}</div></div>)}</div>{analysis.summaryReport && <p className="text-xs leading-relaxed text-muted-foreground">{analysis.summaryReport}</p>}{result?.gaps?.length ? <details className="rounded-md border p-2 text-xs"><summary className="cursor-pointer font-medium">{result.gaps.length} prioritized gaps</summary><div className="mt-2 space-y-3">{result.gaps.slice(0, 5).map((gap, index) => <div key={`${gap.section}-${index}`}><p className="font-medium capitalize">{gap.section} · {gap.severity}</p><p className="mt-0.5 text-muted-foreground">{gap.issue}</p><p className="mt-1">{gap.recommendation}</p>{gap.evidence?.length > 0 && <details className="mt-1 text-muted-foreground"><summary className="cursor-pointer">Evidence</summary>{gap.evidence.map((item, evidenceIndex) => <p key={`${item.label}-${evidenceIndex}`} className="mt-1">{item.label}: {item.excerpt}</p>)}</details>}</div>)}</div></details> : null}<Button className="w-full" size="sm" variant="outline" onClick={() => onAskFollowup("Explain the highest-priority gap in this deck analysis and suggest a concrete revision.")}>Ask about this analysis</Button></div>;
}
