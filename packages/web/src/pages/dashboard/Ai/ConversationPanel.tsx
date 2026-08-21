import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowUp, FileSearch, Loader2, OctagonX, Sparkles, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Markdown } from "../../../components/shared/Markdown";
import { Button } from "../../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { Textarea } from "../../../components/ui/textarea";
import { useAiStream } from "../../../hooks/useAiStream";
import { apiErrorMessage } from "../../../lib/api-error";
import { aiRecordLink } from "../../../lib/ai-record-link";
import { cancelAiMessage, createAiAnalysis, createAiMessage, listAiAnalyses, listAiMessages, type AiAnalysis, type AiChatMessage, type AiCitation, type AiSession, type AiStreamEvent } from "../../../lib/ai-api";
import { listDocuments } from "../../../lib/document-api";
import { qk } from "../../../lib/query-keys";
import { cn, formatDate } from "../../../lib/utils";
import { AnalysisCard } from "./AnalysisCard";
import { AiArtifactRenderer } from "./artifacts/AiArtifactRenderer";

const SUGGESTED_PROMPTS = [
  "What should I improve in my pitch deck?",
  "Help me prepare for an investor meeting.",
  "Summarize the documents in my data room.",
];

type Props = {
  startupId: string;
  session: AiSession | null;
  canCreate: boolean;
  canReadDocuments: boolean;
  prefill?: string;
  onStartWithPrompt?: (prompt: string) => void;
  onSelectPersona: (personaId: string | null) => void;
};

type TimelineEntry = { type: "message"; createdAt: string; message: AiChatMessage } | { type: "analysis"; createdAt: string; analysis: AiAnalysis };

export function ConversationPanel({ startupId, session, canCreate, canReadDocuments, prefill, onStartWithPrompt, onSelectPersona }: Props) {
  const queryClient = useQueryClient();
  const { open, close } = useAiStream();
  const [draft, setDraft] = useState("");
  const activeStreamId = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftKey = session ? `ai-draft:${startupId}:${session.id}` : null;

  const messagesQuery = useQuery({
    queryKey: ["ai-messages", startupId, session?.id],
    queryFn: () => listAiMessages(startupId, session!.id),
    enabled: Boolean(session),
    // The SSE stream is the live channel for an in-flight message; a background REST
    // refetch (e.g. on window focus) would read the database, which only gets this
    // message's content once, at completion — a focus change mid-stream would replace
    // the already-rendered text with that stale empty value.
    refetchOnWindowFocus: false,
  });
  const messages = messagesQuery.data ?? [];

  const documentsQuery = useQuery({
    queryKey: ["documents", startupId, "ai-analyze"],
    queryFn: () => listDocuments(startupId, { page: 1, limit: 100 }),
    enabled: canReadDocuments && Boolean(session),
  });
  const documentTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const document of documentsQuery.data?.data ?? []) {
      if (document.currentVersion) map.set(document.currentVersion.id, document.title);
    }
    return map;
  }, [documentsQuery.data]);
  const readyDocuments = (documentsQuery.data?.data ?? []).filter((document) => document.currentVersion?.processingStatus === "ready");

  const analysesQueryKey = ["ai-analyses-session", startupId, session?.id];
  const analysesQuery = useQuery({
    queryKey: analysesQueryKey,
    queryFn: () => listAiAnalyses(startupId, { sessionId: session!.id }),
    enabled: Boolean(session),
    refetchInterval: (query) => (query.state.data?.some((analysis) => analysis.status === "queued" || analysis.status === "processing") ? 2_500 : false),
  });
  const analyses = analysesQuery.data ?? [];

  const createAnalysisMutation = useMutation({
    mutationFn: (documentVersionId: string) => createAiAnalysis(startupId, { documentVersionId, sessionId: session!.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: analysesQueryKey });
      toast.success("Deck analysis queued");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not queue deck analysis")),
  });

  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [
      ...messages.map((message): TimelineEntry => ({ type: "message", createdAt: message.createdAt, message })),
      ...analyses.map((analysis): TimelineEntry => ({ type: "analysis", createdAt: analysis.createdAt, analysis })),
    ];
    return entries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [messages, analyses]);

  useEffect(() => {
    setDraft(draftKey ? localStorage.getItem(draftKey) ?? "" : "");
  }, [draftKey]);
  useEffect(() => {
    if (prefill) setDraft(prefill);
  }, [prefill]);
  useEffect(() => {
    if (draftKey) localStorage.setItem(draftKey, draft);
  }, [draft, draftKey]);
  useEffect(() => close, [close, session?.id]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  const streamingContent = messages.find((message) => message.status === "streaming")?.content;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [timeline.length, streamingContent]);

  const applyEvent = (messageId: string, event: AiStreamEvent) => {
    queryClient.setQueryData<AiChatMessage[]>(["ai-messages", startupId, session?.id], (current = []) =>
      current.map((message) => {
        if (message.id !== messageId) return message;
        if (event.type === "message.delta") {
          return { ...message, status: "streaming", content: message.content + String(event.payload.text ?? "") };
        }
        if (event.type === "message.snapshot") {
          // A snapshot can arrive from a stale database read mid-stream (see the
          // refetchOnWindowFocus note above); never let it erase locally-accumulated
          // text that's already longer than what the snapshot is offering.
          const incoming = String(event.payload.content ?? "");
          const content = incoming.length >= message.content.length ? incoming : message.content;
          return { ...message, status: String(event.payload.status ?? message.status) as AiChatMessage["status"], content };
        }
        if (event.type === "citation.added") {
          const citation = event.payload.citation as AiCitation | undefined;
          if (!citation || message.citations.some((existing) => existing.id === citation.id)) return message;
          return { ...message, citations: [...message.citations, citation] };
        }
        if (event.type === "artifact.ready") {
          const artifact = event.payload.artifact as AiChatMessage["artifacts"][number] | undefined;
          if (!artifact || message.artifacts.some((existing) => existing.id === artifact.id)) return message;
          return { ...message, artifacts: [...message.artifacts, artifact] };
        }
        if (event.type === "message.completed") return { ...message, status: "completed", content: String(event.payload.content ?? message.content) };
        if (event.type === "message.failed") return { ...message, status: "failed", errorMessage: "The AI response could not be completed." };
        if (event.type === "message.cancelled") return { ...message, status: "cancelled" };
        return event.type === "message.started" ? { ...message, status: "streaming" } : message;
      }),
    );
  };

  useEffect(() => {
    if (!session) return;
    const active = messages.find((message) => message.role === "assistant" && (message.status === "pending" || message.status === "streaming"));
    if (!active || activeStreamId.current === active.id) return;
    activeStreamId.current = active.id;
    const streamUrl = `/api/v1/startups/${startupId}/ai/sessions/${session.id}/messages/${active.id}/stream`;
    void open({
      url: streamUrl,
      onEvent: (event) => applyEvent(active.id, event),
      onError: () => {
        queryClient.setQueryData<AiChatMessage[]>(["ai-messages", startupId, session.id], (current = []) =>
          current.map((message) => (message.id === active.id ? { ...message, status: "failed", errorMessage: "Connection to the AI response was lost." } : message)),
        );
      },
    }).finally(() => {
      activeStreamId.current = null;
    });
  }, [messages, open, queryClient, session, startupId]);

  useEffect(() => {
    if (!session || session.title) return;
    const justCompleted = messages.some((message) => message.role === "assistant" && message.status === "completed");
    if (!justCompleted) return;
    const timeout = window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: qk.aiSessions(startupId) }), 1_200);
    return () => window.clearTimeout(timeout);
  }, [messages, session, queryClient, startupId]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!session) throw new Error("Start a conversation first");
      return createAiMessage(startupId, session.id, content, crypto.randomUUID());
    },
    onSuccess: () => {
      setDraft("");
      if (draftKey) localStorage.removeItem(draftKey);
      void queryClient.invalidateQueries({ queryKey: ["ai-messages", startupId, session?.id] });
      void queryClient.invalidateQueries({ queryKey: qk.aiSessions(startupId) });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not send your message")),
  });

  const cancelMutation = useMutation({
    mutationFn: (messageId: string) => cancelAiMessage(startupId, session!.id, messageId),
    onSuccess: () => close(),
    onError: (error) => toast.error(apiErrorMessage(error, "Could not stop the response")),
  });

  function submit() {
    const content = draft.trim();
    if (content && !sendMutation.isPending && canCreate) sendMutation.mutate(content);
  }

  if (!session) {
    return <Welcome canCreate={canCreate} onSelectPrompt={onStartWithPrompt} />;
  }

  const activeAssistant = messages.find((message) => message.role === "assistant" && (message.status === "pending" || message.status === "streaming"));

  return (
    <main className="flex min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border/60 bg-card/40 px-6 py-3.5 backdrop-blur-sm">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-sm font-semibold leading-tight">{session.title ?? "Untitled conversation"}</h2>
          <p className="text-[11px] text-muted-foreground">Private to you · grounded in documents you can access</p>
        </div>
        {session.persona && (
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 py-1 pl-2.5 pr-1 text-[11px] font-medium text-primary">
            <UserRound className="h-3 w-3" /> {session.persona.name ?? "Investor persona"}
            <button type="button" onClick={() => onSelectPersona(null)} className="rounded-full px-1.5 py-0.5 text-primary/70 hover:bg-primary/15 hover:text-primary">
              Stop
            </button>
          </div>
        )}
      </div>

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto scroll-smooth px-6 py-8">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-7">
          {messagesQuery.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading conversation
            </div>
          )}
          {messagesQuery.isError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              This conversation is unavailable with your current permissions.
            </div>
          )}
          {timeline.map((entry) =>
            entry.type === "message" ? (
              <MessageBubble
                key={entry.message.id}
                message={entry.message}
                onStop={activeAssistant?.id === entry.message.id ? () => cancelMutation.mutate(entry.message.id) : undefined}
                stopping={cancelMutation.isPending}
              />
            ) : (
              <AnalysisCard
                key={entry.analysis.id}
                startupId={startupId}
                sessionId={session.id}
                analysis={entry.analysis}
                documentTitle={documentTitleById.get(entry.analysis.documentVersionId) ?? "Document"}
                canCreate={canCreate}
                onAskFollowup={setDraft}
                onSelectPersona={onSelectPersona}
                selectedPersonaId={session.persona?.id ?? null}
              />
            ),
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border/60 bg-card/30 px-6 py-4">
        <div className="mx-auto w-full max-w-2xl">
          {canReadDocuments && (
            <div className="mb-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!canCreate || readyDocuments.length === 0}>
                    <FileSearch className="h-3.5 w-3.5" /> Analyze a deck
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {readyDocuments.map((document) => (
                    <DropdownMenuItem key={document.currentVersion!.id} onSelect={() => createAnalysisMutation.mutate(document.currentVersion!.id)}>
                      {document.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          <div className={cn("flex items-end gap-2 rounded-2xl border border-border/70 bg-surface/60 px-3 py-2 shadow-sm transition-colors focus-within:border-primary/40", (!canCreate || Boolean(activeAssistant)) && "opacity-70")}>
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              disabled={!canCreate || sendMutation.isPending || Boolean(activeAssistant)}
              placeholder={canCreate ? "Ask about anything in your workspace…" : "You do not have permission to send AI messages."}
              aria-label="Message AI Copilot"
              rows={1}
              className="min-h-[28px] flex-1 resize-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
            />
            <Button
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              onClick={submit}
              disabled={!draft.trim() || !canCreate || sendMutation.isPending || Boolean(activeAssistant)}
              aria-label="Send message"
            >
              {sendMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">Enter to send · Shift + Enter for a new line</p>
        </div>
      </div>
    </main>
  );
}

function Citation({ citation }: { citation: AiCitation }) {
  const link = aiRecordLink(citation.sourceType, citation.sourceId, citation.metadata);
  return (
    <details className="rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs">
      <summary className="cursor-pointer list-none font-medium text-muted-foreground marker:content-none">Source: {citation.label}</summary>
      {citation.excerpt && <p className="mt-1.5 text-muted-foreground/90">{citation.excerpt}</p>}
      {link && (
        <Link className="mt-2 inline-block text-primary hover:underline" to={link}>
          Open source
        </Link>
      )}
    </details>
  );
}

function Welcome({ canCreate, onSelectPrompt }: { canCreate: boolean; onSelectPrompt?: (prompt: string) => void }) {
  return (
    <main className="flex min-h-[460px] flex-col items-center justify-center px-6 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="mt-4 font-display text-xl font-semibold">How can I help?</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">Start a conversation. Copilot searches everything in this workspace you're allowed to access.</p>
      <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={!canCreate}
            onClick={() => onSelectPrompt?.(prompt)}
            className="rounded-full border border-border/70 px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border/70 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            {prompt}
          </button>
        ))}
      </div>
    </main>
  );
}

function MessageBubble({ message, onStop, stopping }: { message: AiChatMessage; onStop?: () => void; stopping: boolean }) {
  const assistant = message.role === "assistant";
  // A source_answer artifact already carries this same text plus a deduplicated
  // source list, so once it lands we drop the raw bubble and the separate
  // citations list instead of showing the identical answer and sources twice.
  const sourceAnswerArtifact = assistant ? message.artifacts.find((artifact) => artifact.type === "source_answer.v1") : undefined;
  const otherArtifacts = assistant ? message.artifacts.filter((artifact) => artifact.type !== "source_answer.v1") : [];
  const thinking = assistant && !message.content && !sourceAnswerArtifact;

  return (
    <article className={cn("group flex gap-3", assistant ? "flex-row" : "flex-row-reverse")}>
      {assistant && (
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
      )}
      <div className={cn("min-w-0 flex-1", assistant ? "max-w-[calc(100%-2.5rem)]" : "flex flex-col items-end")}>
        {!sourceAnswerArtifact && (
          <div className={cn(!assistant && "max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/15 px-4 py-2.5 text-sm leading-relaxed text-foreground")}>
            {thinking ? (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </span>
            ) : assistant ? (
              <Markdown>{message.content}</Markdown>
            ) : (
              <span className="whitespace-pre-wrap">{message.content}</span>
            )}
          </div>
        )}

        {assistant && sourceAnswerArtifact && <AiArtifactRenderer artifact={sourceAnswerArtifact} />}
        {assistant && otherArtifacts.map((artifact) => <AiArtifactRenderer key={artifact.id} artifact={artifact} />)}

        <div className={cn("mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground", assistant ? "" : "flex-row-reverse")}>
          <span className="opacity-0 transition-opacity group-hover:opacity-100">{formatDate(message.createdAt)}</span>
          {message.status === "streaming" && <span className="text-primary/80">Streaming</span>}
          {onStop && (
            <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={onStop} disabled={stopping}>
              <OctagonX className="h-3 w-3" /> Stop
            </Button>
          )}
          {message.status === "failed" && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {message.errorMessage ?? "Response failed"}
            </span>
          )}
        </div>

        {assistant && !sourceAnswerArtifact && message.citations.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {message.citations.map((citation) => (
              <Citation key={citation.id} citation={citation} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
