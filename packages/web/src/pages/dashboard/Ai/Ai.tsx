import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, FileText, Loader2, MessageSquarePlus, Sparkles, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Select } from "../../../components/ui/select";
import { Skeleton } from "../../../components/ui/skeleton";
import { usePermissions } from "../../../hooks/usePermissions";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { apiErrorMessage } from "../../../lib/api-error";
import { createAiSession, listAiSessions, type AiSession } from "../../../lib/ai-api";
import { listDocuments } from "../../../lib/document-api";
import { listFundraisingRounds } from "../../../lib/fundraising-api";
import { qk } from "../../../lib/query-keys";
import { cn, formatDate } from "../../../lib/utils";

const starterPrompts = [
  "What should I improve in my pitch deck?",
  "Help me prepare for an investor meeting.",
  "Summarize the selected documents.",
];

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

  const sessionsQuery = useQuery({
    queryKey: qk.aiSessions(startupId),
    queryFn: () => listAiSessions(startupId),
    enabled: canUseCopilot,
  });
  const documentsQuery = useQuery({
    queryKey: ["documents", startupId, "ai-context"],
    queryFn: () => listDocuments(startupId, { page: 1, limit: 100 }),
    enabled: canReadDocuments,
  });
  const roundsQuery = useQuery({
    queryKey: qk.rounds(startupId),
    queryFn: () => listFundraisingRounds(startupId),
    enabled: canReadFinancial,
  });

  const createSessionMutation = useMutation({
    mutationFn: () => createAiSession(startupId, {
      contextMode: "selected",
      documentVersionIds: selectedVersionIds,
      ...(roundId ? { roundId } : {}),
    }),
    onSuccess: (session) => {
      queryClient.setQueryData<AiSession[]>(qk.aiSessions(startupId), (current = []) => [session, ...current]);
      setSelectedSessionId(session.id);
      toast.success("New Copilot conversation ready");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not create a Copilot session")),
  });

  const sessions = sessionsQuery.data ?? [];
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const readyDocuments = (documentsQuery.data?.data ?? []).filter((document) => document.currentVersion?.processingStatus === "ready");
  const rounds = roundsQuery.data?.data ?? [];

  function toggleVersion(versionId: string) {
    setSelectedVersionIds((current) => current.includes(versionId)
      ? current.filter((id) => id !== versionId)
      : [...current, versionId]);
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary"><Sparkles className="h-4 w-4" /><span className="font-mono text-xs font-medium uppercase tracking-widest">AI workspace</span></div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Copilot</h1>
          <p className="mt-1 text-sm text-muted-foreground">Private, permission-aware help for your fundraising work.</p>
        </div>
        <Button onClick={() => createSessionMutation.mutate()} disabled={!canCreateSession || createSessionMutation.isPending}>
          {createSessionMutation.isPending ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />}
          New conversation
        </Button>
      </header>

      {!canUseCopilot ? (
        <div className="card-elevated p-8 text-center"><Bot className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 font-display text-lg font-semibold">Copilot is unavailable</h2><p className="mt-1 text-sm text-muted-foreground">You do not have access to AI Copilot in this workspace.</p></div>
      ) : (
        <div className="grid min-h-[620px] overflow-hidden rounded-xl border bg-card lg:grid-cols-[250px_minmax(0,1fr)_280px]">
          <aside className="border-b p-3 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between px-1"><h2 className="font-display text-sm font-semibold">Conversations</h2><span className="font-mono text-[11px] text-muted-foreground">{sessions.length}</span></div>
            {sessionsQuery.isPending ? <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div> : sessionsQuery.isError ? <p className="px-1 text-sm text-muted-foreground">Could not load conversations.</p> : sessions.length === 0 ? <p className="px-1 text-sm text-muted-foreground">Start a private conversation to keep your work organized.</p> : <div className="space-y-1">{sessions.map((session) => <SessionButton key={session.id} session={session} selected={session.id === selectedSessionId} onClick={() => setSelectedSessionId(session.id)} />)}</div>}
          </aside>

          <main className="flex min-h-[360px] flex-col items-center justify-center border-b px-6 py-12 text-center lg:border-b-0">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary"><Sparkles className="h-6 w-6" /></div>
            <h2 className="mt-4 font-display text-xl font-semibold">{selectedSession ? selectedSession.title ?? "Untitled conversation" : "How can I help?"}</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">{selectedSession ? "The conversation interface is ready for your selected context." : "Choose relevant context, then start a conversation. Copilot only uses information you are allowed to access."}</p>
            {!selectedSession && <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">{starterPrompts.map((prompt) => <span key={prompt} className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground">{prompt}</span>)}</div>}
            <p className="mt-8 text-xs text-muted-foreground">Messaging and streamed answers arrive in the next workspace update.</p>
          </main>

          <aside className="p-4">
            <h2 className="font-display text-sm font-semibold">Conversation context</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Select only information that should be available to a new conversation.</p>
            {selectedSession ? <SelectedContext session={selectedSession} /> : <>
              {canReadDocuments && <div className="mt-5"><div className="flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4 text-muted-foreground" /> Documents</div><div className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1">{readyDocuments.length === 0 ? <p className="text-xs text-muted-foreground">No ready documents available.</p> : readyDocuments.map((document) => { const version = document.currentVersion!; return <label key={version.id} className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-muted"><Checkbox checked={selectedVersionIds.includes(version.id)} onChange={() => toggleVersion(version.id)} /><span className="min-w-0 text-xs"><span className="block truncate text-foreground">{document.title}</span><span className="text-muted-foreground">Version {version.versionNumber}</span></span></label>; })}</div></div>}
              {canReadFinancial && <div className="mt-5"><div className="flex items-center gap-2 text-sm font-medium"><Wallet className="h-4 w-4 text-muted-foreground" /> Round</div><Select className="mt-2" value={roundId ?? ""} onValueChange={(value) => setRoundId(value || undefined)} placeholder="No round selected" options={[{ value: "", label: "No round selected" }, ...rounds.map((round) => ({ value: round.id, label: round.roundName }))]} /></div>}
              {!canReadDocuments && !canReadFinancial && <p className="mt-5 rounded-md bg-muted p-3 text-xs text-muted-foreground">No optional workspace context is available with your current permissions.</p>}
            </>}
          </aside>
        </div>
      )}
    </div>
  );
}

function SessionButton({ session, selected, onClick }: { session: AiSession; selected: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn("w-full rounded-md p-2 text-left transition-colors", selected ? "bg-primary/10 text-foreground" : "hover:bg-muted")}><div className="truncate text-sm font-medium">{session.title ?? "Untitled conversation"}</div><div className="mt-0.5 text-xs text-muted-foreground">{formatDate(session.lastMessageAt ?? session.createdAt)}</div></button>;
}

function SelectedContext({ session }: { session: AiSession }) {
  const documentCount = session.documents?.length ?? 0;
  return <div className="mt-5 space-y-4 text-sm"><div><div className="flex items-center gap-2 font-medium"><FileText className="h-4 w-4 text-muted-foreground" /> Documents</div><p className="mt-1 text-xs text-muted-foreground">{documentCount ? `${documentCount} selected document${documentCount === 1 ? "" : "s"}` : "No documents selected"}</p></div>{session.roundId && <div><div className="flex items-center gap-2 font-medium"><Wallet className="h-4 w-4 text-muted-foreground" /> Round</div><p className="mt-1 text-xs text-muted-foreground">Selected for this conversation</p></div>}</div>;
}
