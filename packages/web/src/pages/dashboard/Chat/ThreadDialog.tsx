import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Skeleton } from "../../../components/ui/skeleton";
import { apiErrorMessage } from "../../../lib/api-error";
import { qk } from "../../../lib/query-keys";
import { listReplies, toggleReaction } from "../../../lib/chat-api";
import { useResolvedMentions } from "../../../hooks/useResolvedMentions";
import { MessageItem } from "../../../components/mentions/MessageItem";
import { Composer } from "./Composer";

type ThreadDialogProps = {
  startupId: string;
  conversationId: string;
  conversationName: string;
  canSend: boolean;
  /** Null closes the dialog — same "controlled by the parent's selection" pattern as Chat's own selectedId. */
  messageId: string | null;
  onClose: () => void;
};

export function ThreadDialog({
  startupId,
  conversationId,
  conversationName,
  canSend,
  messageId,
  onClose,
}: ThreadDialogProps) {
  const queryClient = useQueryClient();

  const threadQuery = useQuery({
    queryKey: qk.replies(startupId, messageId),
    queryFn: () => listReplies(startupId, conversationId, messageId!),
    enabled: messageId !== null,
  });

  const allMessages = useMemo(
    () => (threadQuery.data ? [threadQuery.data.parent, ...threadQuery.data.replies] : []),
    [threadQuery.data],
  );
  const resolved = useResolvedMentions(startupId, allMessages);

  const reactMutation = useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string }) => toggleReaction(startupId, id, emoji),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.replies(startupId, messageId) }),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not react to that message")),
  });

  function invalidateAfterSend() {
    void queryClient.invalidateQueries({ queryKey: qk.replies(startupId, messageId) });
  }

  return (
    <Dialog open={messageId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle>Thread</DialogTitle>
        </DialogHeader>

        <div className="scrollbar-slim min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {threadQuery.isLoading ? (
            <div className="space-y-4" aria-hidden>
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/4" />
                    <Skeleton className="h-3.5 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : threadQuery.isError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
              {apiErrorMessage(threadQuery.error, "Failed to load the thread.")}
            </div>
          ) : threadQuery.data ? (
            <>
              <MessageItem
                message={threadQuery.data.parent}
                resolved={resolved}
                onReact={
                  canSend ? (emoji) => reactMutation.mutate({ id: threadQuery.data!.parent.id, emoji }) : undefined
                }
              />

              <div className="border-t border-border/60 pt-4 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {threadQuery.data.replies.length === 0
                  ? "No replies yet"
                  : `${threadQuery.data.replies.length} ${threadQuery.data.replies.length === 1 ? "reply" : "replies"}`}
              </div>

              {threadQuery.data.replies.map((reply) => (
                <MessageItem
                  key={reply.id}
                  message={reply}
                  resolved={resolved}
                  onReact={canSend ? (emoji) => reactMutation.mutate({ id: reply.id, emoji }) : undefined}
                />
              ))}
            </>
          ) : null}
        </div>

        {canSend && messageId && (
          <Composer
            startupId={startupId}
            conversationId={conversationId}
            conversationName={conversationName}
            parentMessageId={messageId}
            placeholder="Reply in thread"
            onSent={invalidateAfterSend}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
