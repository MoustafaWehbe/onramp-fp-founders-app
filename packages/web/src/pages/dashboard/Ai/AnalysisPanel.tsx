import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BarChart3, FileSearch, Loader2, RotateCcw, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { apiErrorMessage } from "../../../lib/api-error";
import { cancelAiAnalysis, createAiAnalysis, getAiAnalysis, listAiAnalyses, type AiAnalysis, type AiSession, type AiSessionDocument } from "../../../lib/ai-api";

type Props = { startupId: string; session: AiSession; canCreate: boolean; onAskFollowup: (prompt: string) => void; onSelectPersona: (personaId: string | null) => void };

export function AnalysisPanel({ startupId, session, canCreate, onAskFollowup, onSelectPersona }: Props) {
  const documents = session.documents ?? [];
  if (!documents.length) return null;
  return <section className="mt-6 border-t pt-5">
    <div className="flex items-center gap-2 text-sm font-medium"><BarChart3 className="h-4 w-4 text-muted-foreground" /> Deck analysis</div>
    <div className="mt-1 space-y-5">
      {documents.map((document) => <DocumentAnalysis key={document.documentVersionId} startupId={startupId} sessionId={session.id} document={document} canCreate={canCreate} onAskFollowup={onAskFollowup} onSelectPersona={onSelectPersona} selectedPersonaId={session.persona?.id ?? null} showTitle={documents.length > 1} />)}
    </div>
  </section>;
}

function DocumentAnalysis({ startupId, sessionId, document, canCreate, onAskFollowup, onSelectPersona, selectedPersonaId, showTitle }: { startupId: string; sessionId: string; document: AiSessionDocument; canCreate: boolean; onAskFollowup: (prompt: string) => void; onSelectPersona: (personaId: string | null) => void; selectedPersonaId: string | null; showTitle: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = ["ai-analyses", startupId, document.documentVersionId];
  const analysesQuery = useQuery({
    queryKey,
    queryFn: () => listAiAnalyses(startupId, document.documentVersionId),
    refetchInterval: (query) => query.state.data?.some((analysis) => analysis.status === "queued" || analysis.status === "processing") ? 2_500 : false,
  });
  const analyses = analysesQuery.data ?? [];
  const latest = analyses[0];
  const createMutation = useMutation({
    mutationFn: () => createAiAnalysis(startupId, { documentVersionId: document.documentVersionId, sessionId }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); toast.success("Deck analysis queued"); },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not queue deck analysis")),
  });
  const cancelMutation = useMutation({
    mutationFn: (analysisId: string) => cancelAiAnalysis(startupId, analysisId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not cancel analysis")),
  });

  return <div>
    {showTitle && <p className="truncate text-xs font-medium text-foreground">{document.title}</p>}
    <p className={showTitle ? "mt-0.5 text-xs text-muted-foreground" : "text-xs text-muted-foreground"}>Version {document.versionNumber} · rubric-backed feedback</p>
    {analysesQuery.isPending ? <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading analyses</div> : latest ? <AnalysisState startupId={startupId} analysis={latest} onRetry={() => createMutation.mutate()} onCancel={() => cancelMutation.mutate(latest.id)} pending={createMutation.isPending || cancelMutation.isPending} onAskFollowup={onAskFollowup} onSelectPersona={onSelectPersona} selectedPersonaId={selectedPersonaId} canCreate={canCreate} /> : <Button className="mt-3 w-full" size="sm" variant="outline" onClick={() => createMutation.mutate()} disabled={!canCreate || createMutation.isPending}>{createMutation.isPending ? <Loader2 className="animate-spin" /> : <FileSearch />} Analyze this deck</Button>}
  </div>;
}

function AnalysisState({ startupId, analysis, onRetry, onCancel, pending, onAskFollowup, onSelectPersona, selectedPersonaId, canCreate }: { startupId: string; analysis: AiAnalysis; onRetry: () => void; onCancel: () => void; pending: boolean; onAskFollowup: (prompt: string) => void; onSelectPersona: (personaId: string | null) => void; selectedPersonaId: string | null; canCreate: boolean }) {
  if (analysis.status === "queued" || analysis.status === "processing") return <div className="mt-3 rounded-md bg-muted p-3 text-xs"><div className="flex items-center gap-2 font-medium"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {analysis.status === "queued" ? "Analysis queued" : "Analyzing deck"}</div><p className="mt-1 text-muted-foreground">This page will update automatically.</p><Button className="mt-2" size="sm" variant="ghost" onClick={onCancel} disabled={pending}><X /> Cancel</Button></div>;
  if (analysis.status === "failed" || analysis.status === "cancelled") return <div className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-xs"><div className="flex items-center gap-2 font-medium text-destructive"><AlertCircle className="h-3.5 w-3.5" /> {analysis.status === "cancelled" ? "Analysis cancelled" : "Analysis failed"}</div>{analysis.errorMessage && <p className="mt-1 text-muted-foreground">{analysis.errorMessage}</p>}<Button className="mt-2" size="sm" variant="outline" onClick={onRetry} disabled={pending}><RotateCcw /> Run again</Button></div>;
  return <CompletedAnalysis startupId={startupId} analysis={analysis} onAskFollowup={onAskFollowup} onSelectPersona={onSelectPersona} selectedPersonaId={selectedPersonaId} canCreate={canCreate} />;
}

function CompletedAnalysis({ startupId, analysis, onAskFollowup, onSelectPersona, selectedPersonaId, canCreate }: { startupId: string; analysis: AiAnalysis; onAskFollowup: (prompt: string) => void; onSelectPersona: (personaId: string | null) => void; selectedPersonaId: string | null; canCreate: boolean }) {
  const detailQuery = useQuery({ queryKey: ["ai-analysis", startupId, analysis.id], queryFn: () => getAiAnalysis(startupId, analysis.id) });
  const result = analysis.result as { strengths?: Array<{ statement: string }>; gaps?: Array<{ section: string; severity: string; issue: string; recommendation: string; evidence: Array<{ label: string; excerpt: string }> }> } | null;
  const scores = [["Overall", analysis.overallScore], ["Narrative", analysis.narrativeScore], ["Market", analysis.marketValidationScore], ["Financial", analysis.financialScore]] as const;
  return <div className="mt-3 space-y-3"><div className="grid grid-cols-2 gap-2">{scores.map(([label, score]) => <div key={label} className="rounded-md border p-2"><div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 font-display text-lg font-semibold">{score ?? "—"}</div></div>)}</div>{analysis.summaryReport && <p className="text-xs leading-relaxed text-muted-foreground">{analysis.summaryReport}</p>}{result?.gaps?.length ? <details className="rounded-md border p-2 text-xs"><summary className="cursor-pointer font-medium">{result.gaps.length} prioritized gaps</summary><div className="mt-2 space-y-3">{result.gaps.slice(0, 5).map((gap, index) => <div key={`${gap.section}-${index}`}><p className="font-medium capitalize">{gap.section} · {gap.severity}</p><p className="mt-0.5 text-muted-foreground">{gap.issue}</p><p className="mt-1">{gap.recommendation}</p>{gap.evidence?.length > 0 && <details className="mt-1 text-muted-foreground"><summary className="cursor-pointer">Evidence</summary>{gap.evidence.map((item, evidenceIndex) => <p key={`${item.label}-${evidenceIndex}`} className="mt-1">{item.label}: {item.excerpt}</p>)}</details>}</div>)}</div></details> : null}{detailQuery.data?.personas?.length ? <details className="rounded-md border p-2 text-xs"><summary className="cursor-pointer font-medium">Investor rehearsal</summary><p className="mt-1 text-muted-foreground">These are AI-generated simulations, not real investors.</p><div className="mt-2 space-y-2">{detailQuery.data.personas.map((persona) => <div key={persona.id} className="rounded border p-2"><p className="font-medium">{persona.personaName ?? "Investor persona"}</p><p className="mt-1 text-muted-foreground line-clamp-2">{persona.description}</p><Button className="mt-2" size="sm" variant={selectedPersonaId === persona.id ? "secondary" : "outline"} onClick={() => onSelectPersona(selectedPersonaId === persona.id ? null : persona.id)} disabled={!canCreate}><UserRound /> {selectedPersonaId === persona.id ? "Stop simulation" : "Rehearse with this persona"}</Button></div>)}</div></details> : null}<Button className="w-full" size="sm" variant="outline" onClick={() => onAskFollowup("Explain the highest-priority gap in this deck analysis and suggest a concrete revision.")}>Ask about this analysis</Button></div>;
}
