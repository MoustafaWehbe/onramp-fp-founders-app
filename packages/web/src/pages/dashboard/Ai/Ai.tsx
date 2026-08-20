import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, FileText, FileUp, Loader2, MessageSquarePlus, Search, Sparkles, Trash2, Wallet, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { Skeleton } from "../../../components/ui/skeleton";
import { usePermissions } from "../../../hooks/usePermissions";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { apiErrorMessage } from "../../../lib/api-error";
import { archiveAiSession, createAiSession, listAiSessions, updateAiSession, type AiSession } from "../../../lib/ai-api";
import { listDocuments, type VaultDocument } from "../../../lib/document-api";
import { listFundraisingRounds } from "../../../lib/fundraising-api";
import { qk } from "../../../lib/query-keys";
import { cn, formatDate } from "../../../lib/utils";
import { AnalysisPanel } from "./AnalysisPanel";
import { ConversationPanel } from "./ConversationPanel";

export function Ai() {
  const startupId = useActiveStartupId();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canUseCopilot = can("ai_reports", "read");
  const canCreateSession = can("ai_reports", "create");
  const canReadDocuments = can("documents", "read");
  const canReadFinancial = can("financial", "read");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>([]);
  const [roundId, setRoundId] = useState<string | undefined>();
  const [analysisPrompt, setAnalysisPrompt] = useState<string | undefined>();
  const [deleteSession, setDeleteSession] = useState<AiSession | null>(null);

  const sessionsQuery = useQuery({ queryKey: qk.aiSessions(startupId), queryFn: () => listAiSessions(startupId), enabled: canUseCopilot });
  const documentsQuery = useQuery({ queryKey: ["documents", startupId, "ai-context"], queryFn: () => listDocuments(startupId, { page: 1, limit: 100 }), enabled: canReadDocuments });
  const roundsQuery = useQuery({ queryKey: qk.rounds(startupId), queryFn: () => listFundraisingRounds(startupId), enabled: canReadFinancial });
  const sessions = sessionsQuery.data ?? [];
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const readyDocuments = (documentsQuery.data?.data ?? []).filter((document) => document.currentVersion?.processingStatus === "ready");
  const rounds = roundsQuery.data?.data ?? [];

  const createSessionMutation = useMutation({
    mutationFn: () => createAiSession(startupId, { contextMode: "selected", documentVersionIds: selectedVersionIds, ...(roundId ? { roundId } : {}) }),
    onSuccess: (session) => {
      queryClient.setQueryData<AiSession[]>(qk.aiSessions(startupId), (current = []) => [session, ...current]);
      setSelectedSessionId(session.id);
      setAnalysisPrompt(undefined);
      toast.success("New Copilot conversation ready");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not create a Copilot session")),
  });
  const personaMutation = useMutation({
    mutationFn: (personaId: string | null) => {
      if (!selectedSession) throw new Error("Select a conversation first");
      return updateAiSession(startupId, selectedSession.id, { personaId });
    },
    onSuccess: (session) => {
      queryClient.setQueryData<AiSession[]>(qk.aiSessions(startupId), (current = []) => current.map((item) => item.id === session.id ? { ...item, ...session } : item));
      toast.success(session.persona ? `Simulation enabled: ${session.persona.name ?? "investor persona"}` : "Investor simulation ended");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not update the investor simulation")),
  });
  const archiveMutation = useMutation({
    mutationFn: (session: AiSession) => archiveAiSession(startupId, session.id),
    onSuccess: (_result, session) => {
      queryClient.setQueryData<AiSession[]>(qk.aiSessions(startupId), (current = []) => current.filter((item) => item.id !== session.id));
      if (selectedSessionId === session.id) setSelectedSessionId(null);
      setDeleteSession(null);
      toast.success("Conversation deleted");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not delete this conversation")),
  });

  function toggleVersion(versionId: string) {
    setSelectedVersionIds((current) => current.includes(versionId) ? current.filter((id) => id !== versionId) : [...current, versionId]);
  }

  return <div className="space-y-5 pb-4">
    <header className="relative overflow-hidden rounded-2xl border bg-card px-5 py-6 sm:px-7"><div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" /><div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2 text-primary"><Sparkles className="h-4 w-4" /><span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em]">AI workspace</span></div><h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Copilot</h1><p className="mt-1 max-w-xl text-sm text-muted-foreground">A private research space for sharper fundraising decisions, grounded only in context you can access.</p></div><Button className="shadow-md" onClick={() => createSessionMutation.mutate()} disabled={!canCreateSession || createSessionMutation.isPending}>{createSessionMutation.isPending ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />} New conversation</Button></div></header>
    {!canUseCopilot ? <div className="card-elevated p-8 text-center"><Bot className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 font-display text-lg font-semibold">Copilot is unavailable</h2><p className="mt-1 text-sm text-muted-foreground">You do not have access to AI Copilot in this workspace.</p></div> : <div className="grid min-h-[680px] overflow-hidden rounded-2xl border bg-card shadow-sm xl:grid-cols-[272px_minmax(0,1fr)_320px]"><aside className="border-b bg-muted/20 p-3 xl:border-b-0 xl:border-r"><div className="mb-3 flex items-center justify-between px-2 pt-1"><div><h2 className="font-display text-sm font-semibold">Conversations</h2><p className="mt-0.5 text-xs text-muted-foreground">Your private threads</p></div><Badge variant="secondary" className="font-mono text-[10px]">{sessions.length}</Badge></div><Button className="mb-3 w-full" variant="outline" size="sm" onClick={() => createSessionMutation.mutate()} disabled={!canCreateSession || createSessionMutation.isPending}><MessageSquarePlus /> Start fresh</Button>{sessionsQuery.isPending ? <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : sessionsQuery.isError ? <p className="px-2 text-sm text-muted-foreground">Could not load conversations.</p> : sessions.length === 0 ? <div className="rounded-xl border border-dashed bg-background/70 p-4 text-sm text-muted-foreground">Your conversations will appear here. Set the context, then start your first one.</div> : <nav className="max-h-[510px] space-y-1 overflow-y-auto pr-1" aria-label="AI conversations">{sessions.map((session) => <SessionButton key={session.id} session={session} selected={session.id === selectedSessionId} onClick={() => setSelectedSessionId(session.id)} />)}</nav>}</aside><ConversationPanel startupId={startupId} session={selectedSession} canCreate={canCreateSession} prefill={analysisPrompt} /><aside className="border-t bg-muted/[0.14] p-4 xl:border-l xl:border-t-0">{selectedSession ? <SelectedContext session={selectedSession} onNewConversation={() => createSessionMutation.mutate()} onDelete={() => setDeleteSession(selectedSession)} /> : <ContextBuilder documents={readyDocuments} selectedVersionIds={selectedVersionIds} onToggleVersion={toggleVersion} onSelectAll={() => setSelectedVersionIds(readyDocuments.map((document) => document.currentVersion!.id))} onClear={() => setSelectedVersionIds([])} canReadDocuments={canReadDocuments} canReadFinancial={canReadFinancial} roundId={roundId} onRoundChange={setRoundId} rounds={rounds} loadingDocuments={documentsQuery.isPending} />}{selectedSession && <AnalysisPanel startupId={startupId} session={selectedSession} canCreate={canCreateSession} onAskFollowup={setAnalysisPrompt} onSelectPersona={(personaId) => personaMutation.mutate(personaId)} />}</aside></div>}
    <Dialog open={Boolean(deleteSession)} onOpenChange={(open) => { if (!open && !archiveMutation.isPending) setDeleteSession(null); }}><DialogContent><DialogHeader><DialogTitle>Delete this conversation?</DialogTitle><DialogDescription>This removes “{deleteSession?.title ?? "Untitled conversation"}” from your conversation list. Its messages will no longer appear in Copilot.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteSession(null)} disabled={archiveMutation.isPending}>Cancel</Button><Button variant="destructive" onClick={() => deleteSession && archiveMutation.mutate(deleteSession)} disabled={archiveMutation.isPending}>{archiveMutation.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete conversation</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function SessionButton({ session, selected, onClick }: { session: AiSession; selected: boolean; onClick: () => void }) {
  const documentCount = session.documents?.length ?? 0;
  return <button type="button" onClick={onClick} className={cn("group w-full rounded-xl border px-3 py-2.5 text-left transition-colors", selected ? "border-primary/25 bg-primary/10 shadow-sm" : "border-transparent hover:border-border hover:bg-background")}><div className="flex items-start gap-2"><span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}><Bot className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{session.title ?? "Untitled conversation"}</span><span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"><span>{formatDate(session.lastMessageAt ?? session.createdAt)}</span>{documentCount > 0 && <span>{documentCount} doc{documentCount === 1 ? "" : "s"}</span>}</span></span></div></button>;
}

function ContextBuilder({ documents, selectedVersionIds, onToggleVersion, onSelectAll, onClear, canReadDocuments, canReadFinancial, roundId, onRoundChange, rounds, loadingDocuments }: { documents: VaultDocument[]; selectedVersionIds: string[]; onToggleVersion: (versionId: string) => void; onSelectAll: () => void; onClear: () => void; canReadDocuments: boolean; canReadFinancial: boolean; roundId: string | undefined; onRoundChange: (roundId: string | undefined) => void; rounds: Array<{ id: string; roundName: string }>; loadingDocuments: boolean }) {
  const [search, setSearch] = useState("");
  const visibleDocuments = useMemo(() => documents.filter((document) => document.title.toLowerCase().includes(search.trim().toLowerCase())), [documents, search]);
  return <div><div className="flex items-start justify-between gap-3"><div><p className="font-display text-sm font-semibold">New conversation context</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose the sources Copilot may use. Nothing else is included.</p></div>{selectedVersionIds.length > 0 && <Badge variant="secondary" className="shrink-0">{selectedVersionIds.length} selected</Badge>}</div>{canReadDocuments && <section className="mt-5"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4 text-primary" /> Documents</div>{documents.length > 0 && <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={selectedVersionIds.length === documents.length ? onClear : onSelectAll}>{selectedVersionIds.length === documents.length ? "Clear all" : "Select all"}</button>}</div><div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 pl-9 text-xs" placeholder="Search ready documents" /></div><div className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">{loadingDocuments ? <><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></> : visibleDocuments.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">{documents.length ? "No documents match your search." : "No processed documents are ready yet."}</p> : visibleDocuments.map((document) => { const version = document.currentVersion!; const selected = selectedVersionIds.includes(version.id); return <label key={version.id} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-2.5 transition-colors", selected ? "border-primary/30 bg-primary/5" : "border-transparent bg-background/70 hover:border-border")}><Checkbox checked={selected} onChange={() => onToggleVersion(version.id)} className="mt-0.5" /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-xs font-medium text-foreground">{document.title}</span>{selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}</span><span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"><FileUp className="h-3 w-3" />{documentTypeLabel(document.documentType)} <span>·</span> v{version.versionNumber}</span></span></label>; })}</div></section>}{canReadFinancial && <section className="mt-5"><div className="flex items-center gap-2 text-sm font-medium"><Wallet className="h-4 w-4 text-primary" /> Fundraising round <span className="font-normal text-muted-foreground">(optional)</span></div><Select className="mt-2" value={roundId ?? ""} onValueChange={(value) => onRoundChange(value || undefined)} placeholder="Keep this conversation general" options={[{ value: "", label: "Keep this conversation general" }, ...rounds.map((round) => ({ value: round.id, label: round.roundName }))]} /></section>}{!canReadDocuments && !canReadFinancial && <p className="mt-5 rounded-xl border border-dashed bg-background/60 p-3 text-xs leading-relaxed text-muted-foreground">No optional workspace context is available with your current permissions.</p>}{selectedVersionIds.length > 0 && <button type="button" onClick={onClear} className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /> Remove selected documents</button>}</div>;
}

function SelectedContext({ session, onNewConversation, onDelete }: { session: AiSession; onNewConversation: () => void; onDelete: () => void }) {
  const documentCount = session.documents?.length ?? 0;
  return <div><div className="flex items-start justify-between gap-3"><div><p className="font-display text-sm font-semibold">Conversation context</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">This context is locked to keep the discussion grounded.</p></div><Button size="sm" variant="outline" onClick={onNewConversation}><MessageSquarePlus /> New</Button></div><div className="mt-5 rounded-xl border bg-background/75 p-3"><div className="flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4 text-primary" /> Documents <Badge variant="secondary" className="ml-auto">{documentCount}</Badge></div>{documentCount ? <div className="mt-3 space-y-2">{session.documents?.map((document) => <Link key={document.documentVersionId} className="group flex items-center gap-2 rounded-lg p-1 text-xs hover:bg-muted" to={`/documents?documentId=${encodeURIComponent(document.documentId)}`}><FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-primary group-hover:underline">{document.title}</span><span className="text-muted-foreground">v{document.versionNumber}</span></Link>)}</div> : <p className="mt-2 text-xs text-muted-foreground">No documents were selected.</p>}</div>{session.roundId && <Link className="mt-3 flex items-center gap-2 rounded-xl border bg-background/75 p-3 text-xs text-primary hover:bg-muted" to={`/fundraising?round=${encodeURIComponent(session.roundId)}`}><Wallet className="h-4 w-4" /><span className="flex-1">Open selected round</span><span>→</span></Link>}{session.persona && <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3"><p className="text-xs font-medium text-primary">Simulation: {session.persona.name ?? "Investor persona"}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">AI-generated rehearsal, not a real investor.</p></div>}<Button className="mt-4 w-full" variant="ghost" size="sm" onClick={onDelete}><Trash2 className="text-destructive" /> Delete conversation</Button></div>;
}

function documentTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}
