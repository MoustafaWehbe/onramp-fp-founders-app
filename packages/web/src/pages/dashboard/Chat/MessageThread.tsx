import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowLeft, Bell, BellOff, Hash, MessageSquare, User } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/shared/ConfirmDialog";
import { EmptyState } from "../../../components/shared/EmptyState";
import { Skeleton } from "../../../components/ui/skeleton";
import { getInitials } from "../../../lib/utils";
import { apiErrorMessage } from "../../../lib/api-error";
import { qk } from "../../../lib/query-keys";
import { usePermissions } from "../../../hooks/usePermissions";
import { useWorkspace } from "../../../hooks/useWorkspace";
import {
  deleteMessage,
  listMessages,
  markConversationRead,
  setConversationArchived,
  setNotifyLevel,
  sendMessage,
  toggleReaction,
  type Conversation,
  type Message,
} from "../../../lib/chat-api";
import {
  replaceOptimisticMessage,
  retryInputForMessage,
  setOptimisticDeliveryState,
} from "../../../lib/chat-message-cache";
import { useResolvedMentions } from "../../../hooks/useResolvedMentions";
import { useTypingUsers } from "../../../hooks/useTypingUsers";
import { MessageItem } from "../../../components/mentions/MessageItem";
import { Composer } from "./Composer";
import { ThreadDialog } from "./ThreadDialog";

type MessageThreadProps = {
  startupId: string;
  conversation: Conversation;
  canSend: boolean;
  onBack?: () => void;
};

function conversationDisplayName(conversation: Conversation): string {
  if (conversation.type === "channel") return conversation.name ?? "";
  const c = conversation.counterpart;
  return c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Teammate" : "Direct message";
}

/** Consecutive messages from the same sender, close enough together to read as one run, collapse under a single avatar/name same 5-minute window Slack uses. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const MESSAGE_PAGE_SIZE = 50;

function isGrouped(previous: Message | undefined, message: Message): boolean {
  if (!previous || !message.senderId || previous.senderId !== message.senderId) return false;
  return new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS;
}

export function MessageThread({ startupId, conversation, canSend, onBack }: MessageThreadProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [threadMessageId, setThreadMessageId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const typingNames = useTypingUsers(conversation.id);
  const displayName = conversationDisplayName(conversation);
  const { can } = usePermissions();
  const { activeStartup } = useWorkspace();
  const currentMemberId = activeStartup?.member.id ?? null;
  const canModerate = can("chat", "manage");

  const messagesQuery = useInfiniteQuery({
    queryKey: qk.messages(startupId, conversation.id),
    queryFn: ({ pageParam }) =>
      listMessages(startupId, conversation.id, {
        limit: MESSAGE_PAGE_SIZE,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (oldestLoadedPage) =>
      oldestLoadedPage.length === MESSAGE_PAGE_SIZE ? oldestLoadedPage[0]?.seq : undefined,
  });

  const messages = useMemo(() => {
    const seen = new Set<string>();
    return [...(messagesQuery.data?.pages ?? [])]
      .reverse()
      .flat()
      .filter((message) => {
        if (seen.has(message.id)) return false;
        seen.add(message.id);
        return true;
      });
  }, [messagesQuery.data]);
  const resolved = useResolvedMentions(startupId, messages);
  const newestMessageSeq = messages.at(-1)?.seq ?? null;

  /** Scrolling to a sentinel at the very end is more reliable than computing scrollHeight by hand it can't drift out of sync with layout the way a manual scrollTo can. */
  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }

  // A new channel or an incoming live message should both land at the bottom
  // the newest message is what a founder opened the thread to see.
  useEffect(() => {
    scrollToBottom();
  }, [newestMessageSeq, conversation.id]);

  async function loadOlderMessages() {
    const viewport = scrollRef.current;
    const previousHeight = viewport?.scrollHeight ?? 0;
    const previousTop = viewport?.scrollTop ?? 0;
    await messagesQuery.fetchNextPage();
    requestAnimationFrame(() => {
      if (!viewport) return;
      viewport.scrollTop = previousTop + viewport.scrollHeight - previousHeight;
    });
  }

  // Opening a room (or a new message landing while it's open) counts as
  // having seen it clears the unread badge without the founder doing
  // anything extra.
  useEffect(() => {
    if (conversation.unreadCount === 0) return;
    void markConversationRead(startupId, conversation.id)
      .then(() => void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) }))
      .catch(() => {
        // A missed read receipt just leaves the badge stale not worth surfacing.
      });
  }, [startupId, conversation.id, conversation.unreadCount, queryClient]);

  const reactMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      toggleReaction(startupId, messageId, emoji),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.messages(startupId, conversation.id) }),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not react to that message")),
  });

  const retrySendMutation = useMutation({
    mutationFn: async (message: Message) => {
      const input = retryInputForMessage(message);
      if (!input) throw new Error("This message can no longer be retried");
      return sendMessage(startupId, conversation.id, input);
    },
    onMutate: (message) => setOptimisticDeliveryState(queryClient, startupId, message, "sending"),
    onSuccess: (delivered, message) => {
      replaceOptimisticMessage(queryClient, startupId, message, delivered);
      void queryClient.invalidateQueries({ queryKey: qk.messages(startupId, conversation.id) });
      void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) });
    },
    onError: (err, message) => {
      setOptimisticDeliveryState(queryClient, startupId, message, "failed");
      toast.error(apiErrorMessage(err, "Message still could not be sent"));
    },
  });

  const muteMutation = useMutation({
    mutationFn: () => setNotifyLevel(startupId, conversation.id, conversation.notifyLevel === "none" ? "all" : "none"),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) }),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update notifications")),
  });

  const deleteMutation = useMutation({
    mutationFn: (messageId: string) => deleteMessage(startupId, messageId),
    onSuccess: () => {
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: qk.messages(startupId, conversation.id) });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete that message")),
  });

  const archiveMutation = useMutation({
    mutationFn: () => setConversationArchived(startupId, conversation.id, !conversation.archivedAt),
    onSuccess: () => {
      setArchiveConfirmOpen(false);
      toast.success(`#${conversation.name} ${conversation.archivedAt ? "restored" : "archived"}`);
      void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not archive that channel")),
  });

  const muted = conversation.notifyLevel === "none";
  const canChangeArchive = canModerate && conversation.type === "channel";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 md:hidden"
            aria-label="Back to channels"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        {conversation.type === "channel" ? (
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Hash className="h-3.5 w-3.5" />
          </div>
        ) : (
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={conversation.counterpart?.avatarUrl ?? undefined} alt="" className="object-cover" />
            <AvatarFallback className="text-[11px] font-medium">
              {conversation.counterpart ? getInitials(displayName) : <User className="h-3.5 w-3.5" />}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{displayName}</div>
          {conversation.topic && (
            <div className="truncate text-xs text-muted-foreground">{conversation.topic}</div>
          )}
          {conversation.archivedAt && !conversation.topic && (
            <div className="text-xs text-muted-foreground">Archived · read only</div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={muted ? "Unmute this conversation" : "Mute this conversation"}
          onClick={() => muteMutation.mutate()}
          disabled={muteMutation.isPending}
        >
          {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        </Button>
        {canChangeArchive && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            aria-label={conversation.archivedAt ? "Restore this channel" : "Archive this channel"}
            onClick={() => setArchiveConfirmOpen(true)}
          >
            {conversation.archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messagesQuery.isLoading ? (
          <div className="space-y-4" aria-hidden>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-1/4" />
                  <Skeleton className="h-3.5 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : messagesQuery.isError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
            <p>{apiErrorMessage(messagesQuery.error, "Failed to load messages.")}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => void messagesQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No messages yet"
            description={
              canSend
                ? "Say something to get the conversation started."
                : "Nobody has posted here yet."
            }
            compact
          />
        ) : (
          <div>
            {messagesQuery.hasNextPage && (
              <div className="mb-4 flex justify-center">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={messagesQuery.isFetchingNextPage}
                  onClick={() => void loadOlderMessages()}
                >
                  {messagesQuery.isFetchingNextPage ? "Loading…" : "Load older messages"}
                </Button>
              </div>
            )}
            {messages.map((message, index) => (
              <MessageItem
                key={message.id}
                message={message}
                grouped={isGrouped(messages[index - 1], message)}
                resolved={resolved}
                onReact={canSend ? (emoji) => reactMutation.mutate({ messageId: message.id, emoji }) : undefined}
                onOpenThread={message.replyCount > 0 || canSend ? () => setThreadMessageId(message.id) : undefined}
                onDelete={message.senderId === currentMemberId ? () => setDeleteTarget(message) : undefined}
                onRetry={
                  message.deliveryState === "failed"
                    ? () => retrySendMutation.mutate(message)
                    : undefined
                }
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {typingNames.length > 0 && (
        <div className="px-4 pb-1 text-xs italic text-muted-foreground">
          {typingNames.length === 1
            ? `${typingNames[0]} is typing…`
            : `${typingNames.slice(0, 2).join(", ")}${typingNames.length > 2 ? " and others" : ""} are typing…`}
        </div>
      )}

      {canSend && messagesQuery.isSuccess ? (
        <Composer
          startupId={startupId}
          conversationId={conversation.id}
          conversationName={displayName}
          placeholder={conversation.type === "dm" ? `Message ${displayName}` : undefined}
          onSent={() => scrollToBottom("smooth")}
        />
      ) : !messagesQuery.isPending ? (
        <div className="border-t border-border/60 px-4 py-3 text-center text-xs text-muted-foreground">
          {messagesQuery.isError
            ? "Messages must load before you can post here."
            : conversation.archivedAt
            ? "This channel is archived and read only."
            : "You don't have permission to post in this channel."}
        </div>
      ) : null}

      <ThreadDialog
        startupId={startupId}
        conversationId={conversation.id}
        conversationName={displayName}
        canSend={canSend}
        currentMemberId={currentMemberId}
        messageId={threadMessageId}
        onClose={() => setThreadMessageId(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this message?"
        description="This can't be undone. The message will be removed for everyone in this conversation."
        confirmLabel="Delete message"
        pendingLabel="Deleting…"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />

      <ConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        title={`${conversation.archivedAt ? "Restore" : "Archive"} #${conversation.name}?`}
        description={conversation.archivedAt
          ? "The channel will return to the active channel list for its members."
          : "The channel will move to the archived section and become read only. This can be undone later."}
        confirmLabel={conversation.archivedAt ? "Restore channel" : "Archive channel"}
        pendingLabel={conversation.archivedAt ? "Restoring…" : "Archiving…"}
        variant="default"
        isPending={archiveMutation.isPending}
        onConfirm={() => archiveMutation.mutate()}
      />
    </div>
  );
}
