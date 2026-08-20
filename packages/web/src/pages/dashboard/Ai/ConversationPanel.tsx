import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowUp, Loader2, OctagonX, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { useAiStream } from "../../../hooks/useAiStream";
import { apiErrorMessage } from "../../../lib/api-error";
import { cancelAiMessage, createAiMessage, listAiMessages, type AiChatMessage, type AiCitation, type AiSession, type AiStreamEvent } from "../../../lib/ai-api";
import { qk } from "../../../lib/query-keys";
import { cn, formatDate } from "../../../lib/utils";
import { AiArtifactRenderer } from "./artifacts/AiArtifactRenderer";
import { Link } from "react-router-dom";
import { aiRecordLink } from "../../../lib/ai-record-link";

type Props = { startupId: string; session: AiSession | null; canCreate: boolean; prefill?: string; onStartWithPrompt?: (prompt: string) => void };

export function ConversationPanel({ startupId, session, canCreate, prefill, onStartWithPrompt }: Props) {
  const queryClient = useQueryClient();
  const { open, close } = useAiStream();
  const [draft, setDraft] = useState("");
  const activeStreamId = useRef<string | null>(null);
  const draftKey = session ? `ai-draft:${startupId}:${session.id}` : null;
  const messagesQuery = useQuery({
    queryKey: ["ai-messages", startupId, session?.id],
    queryFn: () => listAiMessages(startupId, session!.id),
    enabled: Boolean(session),
  });
  const messages = messagesQuery.data ?? [];

  useEffect(() => {
    setDraft(draftKey ? localStorage.getItem(draftKey) ?? "" : "");
  }, [draftKey]);
  useEffect(() => { if (prefill) setDraft(prefill); }, [prefill]);
  useEffect(() => { if (draftKey) localStorage.setItem(draftKey, draft); }, [draft, draftKey]);
  useEffect(() => close, [close, session?.id]);

  const applyEvent = (messageId: string, event: AiStreamEvent) => {
    queryClient.setQueryData<AiChatMessage[]>(["ai-messages", startupId, session?.id], (current = []) => current.map((message) => {
      if (message.id !== messageId) return message;
      if (event.type === "message.delta") return { ...message, status: "streaming", content: message.content + String(event.payload.text ?? "") };
      if (event.type === "message.snapshot") return { ...message, status: String(event.payload.status ?? message.status) as AiChatMessage["status"], content: String(event.payload.content ?? message.content) };
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
    }));
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
        queryClient.setQueryData<AiChatMessage[]>(["ai-messages", startupId, session.id], (current = []) => current.map((message) => message.id === active.id ? { ...message, status: "failed", errorMessage: "Connection to the AI response was lost." } : message));
      },
    }).finally(() => { activeStreamId.current = null; });
  }, [messages, open, queryClient, session, startupId]);

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

  if (!session) return <Welcome canCreate={canCreate} onSelectPrompt={onStartWithPrompt} />;
  const activeAssistant = messages.find((message) => message.role === "assistant" && (message.status === "pending" || message.status === "streaming"));
  return <main className="flex min-h-[460px] min-w-0 flex-col bg-gradient-to-b from-muted/[0.12] to-transparent">
    <div className="border-b bg-card/75 px-5 py-4 backdrop-blur-sm"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary"><Sparkles className="h-3.5 w-3.5" /></span><h2 className="truncate font-display text-base font-semibold">{session.title ?? "Untitled conversation"}</h2></div><p className="mt-1.5 text-xs text-muted-foreground">Private to you · grounded in this conversation’s context</p></div>
    <div className="scrollbar-slim flex-1 space-y-6 overflow-y-auto px-5 py-6">
      {messagesQuery.isPending && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading conversation</div>}
      {messagesQuery.isError && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">This conversation is unavailable with your current permissions.</div>}
      {messages.map((message) => <MessageBubble key={message.id} message={message} onRetry={message.role === "user" ? () => setDraft(message.content) : undefined} onStop={activeAssistant?.id === message.id ? () => cancelMutation.mutate(message.id) : undefined} stopping={cancelMutation.isPending} />)}
    </div>
    <div className="border-t p-4"><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} disabled={!canCreate || sendMutation.isPending || Boolean(activeAssistant)} placeholder={canCreate ? "Ask about the documents in this conversation…" : "You do not have permission to send AI messages."} aria-label="Message AI Copilot" className="min-h-[76px] resize-none" /><div className="mt-2 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Enter to send · Shift + Enter for a new line</p><Button size="sm" onClick={submit} disabled={!draft.trim() || !canCreate || sendMutation.isPending || Boolean(activeAssistant)}>{sendMutation.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />} Send</Button></div></div>
  </main>;
}

function Citation({ citation }: { citation: AiCitation }) {
  const link = aiRecordLink(citation.sourceType, citation.sourceId, citation.metadata);
  return <details className="rounded-md border bg-background px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Source: {citation.label}</summary>{citation.excerpt && <p className="mt-1 text-muted-foreground">{citation.excerpt}</p>}{link && <Link className="mt-2 inline-block text-primary hover:underline" to={link}>Open source</Link>}</details>;
}

function Welcome({ canCreate, onSelectPrompt }: { canCreate: boolean; onSelectPrompt?: (prompt: string) => void }) { return <main className="flex min-h-[460px] flex-col items-center justify-center px-6 py-12 text-center"><div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary"><Sparkles className="h-6 w-6" /></div><h2 className="mt-4 font-display text-xl font-semibold">How can I help?</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">Choose relevant context, then start a conversation. Copilot only uses information you are allowed to access.</p><div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">{["What should I improve in my pitch deck?", "Help me prepare for an investor meeting.", "Summarize the selected documents."].map((prompt) => <button key={prompt} type="button" disabled={!canCreate} onClick={() => onSelectPrompt?.(prompt)} className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-transparent disabled:hover:text-muted-foreground">{prompt}</button>)}</div></main>; }

function MessageBubble({ message, onRetry, onStop, stopping }: { message: AiChatMessage; onRetry?: () => void; onStop?: () => void; stopping: boolean }) {
  const assistant = message.role === "assistant";
  // A source_answer artifact already carries this same text plus a deduplicated
  // source list, so once it lands we drop the raw bubble and the separate
  // citations list instead of showing the identical answer and sources twice.
  const sourceAnswerArtifact = assistant ? message.artifacts.find((artifact) => artifact.type === "source_answer.v1") : undefined;
  const otherArtifacts = assistant ? message.artifacts.filter((artifact) => artifact.type !== "source_answer.v1") : [];
  return <article className={cn("max-w-[92%]", assistant ? "mr-auto" : "ml-auto")}>{!sourceAnswerArtifact && <div className={cn("rounded-xl px-4 py-3 text-sm leading-relaxed", assistant ? "bg-muted/70 text-foreground" : "bg-primary text-primary-foreground")}>{message.content || (assistant && <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…</span>)}</div>}{assistant && sourceAnswerArtifact && <AiArtifactRenderer artifact={sourceAnswerArtifact} />}{assistant && otherArtifacts.map((artifact) => <AiArtifactRenderer key={artifact.id} artifact={artifact} />)}<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span>{formatDate(message.createdAt)}</span>{message.status === "streaming" && <span>Streaming</span>}{onStop && <Button size="sm" variant="ghost" onClick={onStop} disabled={stopping}><OctagonX /> Stop</Button>}{message.status === "failed" && <span className="inline-flex items-center gap-1 text-destructive"><AlertCircle className="h-3.5 w-3.5" /> {message.errorMessage ?? "Response failed"}</span>}{onRetry && <Button size="sm" variant="ghost" onClick={onRetry}><RotateCcw /> Reuse</Button>}</div>{assistant && !sourceAnswerArtifact && message.citations.length > 0 && <div className="mt-2 space-y-1">{message.citations.map((citation) => <Citation key={citation.id} citation={citation} />)}</div>}</article>;
}
