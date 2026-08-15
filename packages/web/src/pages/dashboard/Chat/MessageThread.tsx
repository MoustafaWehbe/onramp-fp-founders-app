import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Hash, MessageSquare, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { EmptyState } from "../../../components/shared/EmptyState";
import { Skeleton } from "../../../components/ui/skeleton";
import { apiErrorMessage } from "../../../lib/api-error";
import { cn, getInitials } from "../../../lib/utils";
import { qk } from "../../../lib/query-keys";
import { listMessages, sendMessage, type Conversation, type Message } from "../../../lib/chat-api";

function senderName(sender: Message["sender"]): string {
  if (!sender) return "Removed member";
  const name = `${sender.firstName ?? ""} ${sender.lastName ?? ""}`.trim();
  return name || "Teammate";
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
}

type MessageThreadProps = {
  startupId: string;
  conversation: Conversation;
  canSend: boolean;
  onBack?: () => void;
};

export function MessageThread({ startupId, conversation, canSend, onBack }: MessageThreadProps) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const nonceRef = useRef(crypto.randomUUID());
  const scrollRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useQuery({
    queryKey: qk.messages(startupId, conversation.id),
    queryFn: () => listMessages(startupId, conversation.id),
  });

  const messages = messagesQuery.data ?? [];

  // A new channel or an incoming live message should both land at the bottom
  // — the newest message is what a founder opened the thread to see.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, conversation.id]);

  const sendMutation = useMutation({
    mutationFn: () => sendMessage(startupId, conversation.id, { body: body.trim(), clientNonce: nonceRef.current }),
    onSuccess: () => {
      setBody("");
      // Only rotate the nonce once the send is confirmed — an error leaves it
      // in place so retrying the same draft can't double-post.
      nonceRef.current = crypto.randomUUID();
      void queryClient.invalidateQueries({ queryKey: qk.messages(startupId, conversation.id) });
      void queryClient.invalidateQueries({ queryKey: qk.conversations(startupId) });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not send that message")),
  });

  function handleSend() {
    if (!body.trim() || sendMutation.isPending) return;
    sendMutation.mutate();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

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
                ? "Say something to get the conversation started."
                : "Nobody has posted here yet."
            }
            compact
          />
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div key={message.id} className="flex items-start gap-3">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-xs font-medium">
                    {getInitials(senderName(message.sender))}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{senderName(message.sender)}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatTime(message.createdAt)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
                    {message.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {canSend ? (
        <div className="border-t border-border/60 p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message #${conversation.name}`}
              rows={1}
              className="min-h-[2.5rem] resize-none py-2"
              disabled={sendMutation.isPending}
            />
            <Button
              type="button"
              size="icon"
              aria-label="Send message"
              onClick={handleSend}
              disabled={!body.trim() || sendMutation.isPending}
              className={cn("shrink-0")}
            >
              <SendHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t border-border/60 px-4 py-3 text-center text-xs text-muted-foreground">
          You don't have permission to post in this channel.
        </div>
      )}
    </div>
  );
}
