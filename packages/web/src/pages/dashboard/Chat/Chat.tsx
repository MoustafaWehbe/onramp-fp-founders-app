import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "../../../components/layout/PageHeader";
import { apiErrorMessage } from "../../../lib/api-error";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { usePermissions } from "../../../hooks/usePermissions";
import { qk } from "../../../lib/query-keys";
import { cn } from "../../../lib/utils";
import {
  createConversation,
  listConversations,
  startDirectMessage,
  type CreateConversationInput,
} from "../../../lib/chat-api";
import { ConversationList } from "./ConversationList";
import { MessageThread } from "./MessageThread";
import { NewChannelDialog } from "./NewChannelDialog";
import { NewDirectMessageDialog } from "./NewDirectMessageDialog";
import { EmptyState } from "../../../components/shared/EmptyState";
import { MessageSquare } from "lucide-react";

export function Chat() {
  const startupId = useActiveStartupId();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canCreate = can("chat", "create");
  const [searchParams, setSearchParams] = useSearchParams();

  // A notification (a mention or a DM) can deep-link straight to a
  // conversation via `?c=` read once on mount.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => searchParams.get("c"),
  );
  // Mobile's Back action intentionally leaves no room selected. Without this
  // distinction the default-selection effect immediately reopens the room.
  const allowEmptySelectionRef = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDmOpen, setCreateDmOpen] = useState(false);

  const conversationsQuery = useQuery({
    queryKey: qk.conversations(startupId),
    queryFn: () => listConversations(startupId, { includeArchived: true }),
  });

  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);

  const selectConversation = useCallback((id: string | null) => {
    allowEmptySelectionRef.current = id === null;
    setSelectedId(id);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("c", id);
      else next.delete("c");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Land on the most recently active non-archived channel by default. Wait
  // for the list to actually load first otherwise this would clobber a
  // `?c=` deep link with `null` before the real conversations ever arrive.
  useEffect(() => {
    if (conversationsQuery.isLoading) return;
    if (conversations.length === 0 || conversationsQuery.isError) {
      setSelectedId(null);
      return;
    }
    if (selectedId === null && allowEmptySelectionRef.current) return;
    if (!selectedId || !conversations.some((c) => c.id === selectedId)) {
      selectConversation(
        conversations.find((conversation) => !conversation.archivedAt)?.id ?? conversations[0].id,
      );
    }
  }, [
    conversations,
    selectedId,
    conversationsQuery.isLoading,
    conversationsQuery.isError,
    selectConversation,
  ]);

  const createMutation = useMutation({
    mutationFn: (input: CreateConversationInput) => createConversation(startupId, input),
    onSuccess: (conversation) => {
      setCreateOpen(false);
      selectConversation(conversation.id);
      toast.success(`#${conversation.name} created`);
      void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create that channel")),
  });

  const startDmMutation = useMutation({
    mutationFn: (memberId: string) => startDirectMessage(startupId, memberId),
    onSuccess: (conversation) => {
      setCreateDmOpen(false);
      selectConversation(conversation.id);
      void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not start that conversation")),
  });

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100dvh-11.5rem)] min-h-104 flex-col gap-4 sm:h-[calc(100dvh-12.5rem)]">
      <PageHeader title="Chat" description="Talk with your team, right next to the deals you're working." />

      <div className="card-elevated flex min-h-0 flex-1 overflow-hidden">
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={(id) => selectConversation(id)}
          isLoading={conversationsQuery.isLoading}
          error={conversationsQuery.error}
          onRetry={() => void conversationsQuery.refetch()}
          canCreate={canCreate}
          onCreateChannel={() => setCreateOpen(true)}
          onCreateDm={() => setCreateDmOpen(true)}
          className={cn(
            "w-full shrink-0 border-r border-border/60 md:w-64",
            selected ? "hidden md:flex" : "flex",
          )}
        />

        {selected ? (
          <MessageThread
            key={selected.id}
            startupId={startupId}
            conversation={selected}
            canSend={canCreate && !selected.archivedAt}
            onBack={() => selectConversation(null)}
          />
        ) : (
          !conversationsQuery.isLoading &&
          conversations.length > 0 && (
            <div className="hidden flex-1 items-center justify-center md:flex">
              <EmptyState icon={MessageSquare} title="Select a channel" compact />
            </div>
          )
        )}
      </div>

      <NewChannelDialog
        startupId={startupId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        isSubmitting={createMutation.isPending}
        onSubmit={(input) => createMutation.mutate(input)}
      />

      <NewDirectMessageDialog
        startupId={startupId}
        open={createDmOpen}
        onOpenChange={setCreateDmOpen}
        onSelect={(memberId) => startDmMutation.mutate(memberId)}
      />
    </div>
  );
}
