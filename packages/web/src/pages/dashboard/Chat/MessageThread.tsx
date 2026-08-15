import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Hash, MessageSquare } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/shared/EmptyState";
import { Skeleton } from "../../../components/ui/skeleton";
import { apiErrorMessage } from "../../../lib/api-error";
import { qk } from "../../../lib/query-keys";
import { listMessages, type Conversation } from "../../../lib/chat-api";
import { useResolvedMentions } from "../../../hooks/useResolvedMentions";
import { MessageItem } from "../../../components/mentions/MessageItem";
import { Composer } from "./Composer";

type MessageThreadProps = {
  startupId: string;
  conversation: Conversation;
  canSend: boolean;
  onBack?: () => void;
};

export function MessageThread({ startupId, conversation, canSend, onBack }: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useQuery({
    queryKey: qk.messages(startupId, conversation.id),
    queryFn: () => listMessages(startupId, conversation.id),
  });

  const messages = messagesQuery.data ?? [];
  const resolved = useResolvedMentions(startupId, messages);

  // A new channel or an incoming live message should both land at the bottom
  // — the newest message is what a founder opened the thread to see.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, conversation.id]);

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
        <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{conversation.name}</div>
          {conversation.topic && (
            <div className="truncate text-xs text-muted-foreground">{conversation.topic}</div>
          )}
        </div>
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
            {apiErrorMessage(messagesQuery.error, "Failed to load messages.")}
          </div>
        ) : messages.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No messages yet"
            description={
              canSend
                ? "Say something to get the conversation started — type @ to reference an investor, deal, task, round or document."
                : "Nobody has posted here yet."
            }
            compact
          />
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageItem key={message.id} message={message} resolved={resolved} />
            ))}
          </div>
        )}
      </div>

      {canSend ? (
        <Composer startupId={startupId} conversationId={conversation.id} conversationName={conversation.name} />
      ) : (
        <div className="border-t border-border/60 px-4 py-3 text-center text-xs text-muted-foreground">
          You don't have permission to post in this channel.
        </div>
      )}
    </div>
  );
}
