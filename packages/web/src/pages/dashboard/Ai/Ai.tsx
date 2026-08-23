import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, MessageSquarePlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../../../components/layout/PageHeader";
import { ConfirmDialog } from "../../../components/shared/ConfirmDialog";
import { EmptyState } from "../../../components/shared/EmptyState";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { Skeleton } from "../../../components/ui/skeleton";
import { usePermissions } from "../../../hooks/usePermissions";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { apiErrorMessage } from "../../../lib/api-error";
import { archiveAiSession, createAiSession, listAiSessions, updateAiSession, type AiSession } from "../../../lib/ai-api";
import { qk } from "../../../lib/query-keys";
import { cn } from "../../../lib/utils";
import { ConversationPanel } from "./ConversationPanel";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}

export function Ai() {
  const startupId = useActiveStartupId();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canUseCopilot = can("ai_reports", "read");
  const canCreateSession = can("ai_reports", "create");
  const canReadDocuments = can("documents", "read");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [analysisPrompt, setAnalysisPrompt] = useState<string | undefined>();
  const [deleteSession, setDeleteSession] = useState<AiSession | null>(null);

  const sessionsQuery = useQuery({ queryKey: qk.aiSessions(startupId), queryFn: () => listAiSessions(startupId), enabled: canUseCopilot });
  const sessions = sessionsQuery.data ?? [];
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;

  const createSessionMutation = useMutation({
    mutationFn: (_initialPrompt?: string) => createAiSession(startupId, { contextMode: "workspace" }),
    onSuccess: (session, initialPrompt) => {
      queryClient.setQueryData<AiSession[]>(qk.aiSessions(startupId), (current = []) => [session, ...current]);
      setSelectedSessionId(session.id);
      setAnalysisPrompt(initialPrompt);
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
      queryClient.setQueryData<AiSession[]>(qk.aiSessions(startupId), (current = []) => current.map((item) => (item.id === session.id ? { ...item, ...session } : item)));
      toast.success(session.persona ? `Simulation enabled: ${session.persona.name ?? "investor persona"}` : "Investor simulation ended");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not update the investor simulation")),
  });
  const renameMutation = useMutation({
    mutationFn: ({ session, title }: { session: AiSession; title: string }) => updateAiSession(startupId, session.id, { title }),
    onSuccess: (session) => {
      queryClient.setQueryData<AiSession[]>(qk.aiSessions(startupId), (current = []) => current.map((item) => (item.id === session.id ? { ...item, ...session } : item)));
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not rename this conversation")),
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

  return (
    <div className="flex h-[calc(100vh-3.5rem-2.5rem)] flex-col gap-5 sm:h-[calc(100vh-3.5rem-3rem)]">
      <PageHeader className="shrink-0" title="Copilot" description="A private research space for sharper fundraising decisions, grounded only in context you can access." />

      {!canUseCopilot ? (
        <div className="card-elevated p-8">
          <EmptyState icon={Bot} title="Copilot is unavailable" description="You do not have access to AI Copilot in this workspace." />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[1fr] overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs xl:grid-cols-[272px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-border/60 bg-surface/30 p-3 xl:border-b-0 xl:border-r">
            <Button className="mb-3 w-full shrink-0 shadow-xs" size="sm" onClick={() => createSessionMutation.mutate(undefined)} disabled={!canCreateSession || createSessionMutation.isPending}>
              {createSessionMutation.isPending ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />} New conversation
            </Button>
            <div className="mb-2 flex shrink-0 items-center justify-between px-1">
              <h2 className="font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversations</h2>
              <Badge variant="secondary" className="font-mono text-[10px]">{sessions.length}</Badge>
            </div>
            {sessionsQuery.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : sessionsQuery.isError ? (
              <p className="px-2 text-sm text-muted-foreground">Could not load conversations.</p>
            ) : sessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-background/40 p-4 text-sm text-muted-foreground">Your conversations will appear here. Start your first one above.</div>
            ) : (
              <nav className="scrollbar-slim min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="AI conversations">
                {sessions.map((session) => (
                  <SessionButton
                    key={session.id}
                    session={session}
                    selected={session.id === selectedSessionId}
                    onClick={() => setSelectedSessionId(session.id)}
                    onRename={(title) => renameMutation.mutate({ session, title })}
                    onDelete={() => setDeleteSession(session)}
                  />
                ))}
              </nav>
            )}
          </aside>

          <ConversationPanel
            startupId={startupId}
            session={selectedSession}
            canCreate={canCreateSession}
            canReadDocuments={canReadDocuments}
            prefill={analysisPrompt}
            onStartWithPrompt={(prompt) => createSessionMutation.mutate(prompt)}
            onSelectPersona={(personaId) => personaMutation.mutateAsync(personaId)}
          />
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteSession)}
        onOpenChange={(open) => !open && setDeleteSession(null)}
        title="Delete this conversation?"
        description={`This removes "${deleteSession?.title ?? "Untitled conversation"}" from your conversation list. Its messages will no longer appear in Copilot.`}
        confirmLabel="Delete conversation"
        pendingLabel="Deleting…"
        isPending={archiveMutation.isPending}
        onConfirm={() => deleteSession && archiveMutation.mutate(deleteSession)}
      />
    </div>
  );
}

function SessionButton({
  session,
  selected,
  onClick,
  onRename,
  onDelete,
}: {
  session: AiSession;
  selected: boolean;
  onClick: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(session.title ?? "");

  function commitRename() {
    setRenaming(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== session.title) onRename(trimmed);
    else setValue(session.title ?? "");
  }

  return (
    <div className={cn("group relative w-full rounded-xl border px-3 py-2.5 transition-colors", selected ? "border-primary/25 bg-primary/10 shadow-xs" : "border-transparent hover:border-border hover:bg-background")}>
      {renaming ? (
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <Bot className="h-3.5 w-3.5" />
          </span>
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              }
              if (event.key === "Escape") {
                setValue(session.title ?? "");
                setRenaming(false);
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-primary/40 bg-background px-1.5 py-0.5 text-sm font-medium text-foreground outline-hidden"
          />
        </div>
      ) : (
        <button type="button" onClick={onClick} className="flex w-full items-start gap-2 text-left">
          <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            <Bot className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate pr-5 text-sm font-medium">{session.title ?? "Untitled conversation"}</span>
            <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{relativeTime(session.lastMessageAt ?? session.createdAt)}</span>
            </span>
          </span>
        </button>
      )}
      {!renaming && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Conversation options"
              className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setValue(session.title ?? "");
                setRenaming(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
