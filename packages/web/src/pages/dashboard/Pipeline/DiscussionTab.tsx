import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Hash, MessageSquare } from "lucide-react";
import { EmptyState } from "../../../components/shared/EmptyState";
import { Skeleton } from "../../../components/ui/skeleton";
import { apiErrorMessage } from "../../../lib/api-error";
import { qk } from "../../../lib/query-keys";
import { listMentionsForTarget } from "../../../lib/chat-api";
import { useResolvedMentions } from "../../../hooks/useResolvedMentions";
import { MessageItem } from "../../../components/mentions/MessageItem";

type DiscussionTabProps = {
  startupId: string;
  pipelineId: string;
  dealLabel: string;
};

/**
 * Every chat message across the workspace's channels that @-references this
 * deal, newest first the backlink query turns an offhand mention into part
 * of the deal's permanent record instead of something you had to be in the
 * room to see. See ChatService.getMentionsForTarget.
 */
export function DiscussionTab({ startupId, pipelineId, dealLabel }: DiscussionTabProps) {
  const backlinkQuery = useQuery({
    queryKey: qk.mentionBacklink(startupId, "deal", pipelineId),
    queryFn: () => listMentionsForTarget(startupId, "deal", pipelineId),
  });

  const entries = useMemo(() => backlinkQuery.data ?? [], [backlinkQuery.data]);
  const messages = useMemo(() => entries.map((entry) => entry.message), [entries]);
  const resolved = useResolvedMentions(startupId, messages);

  return (
    <div>
      <div className="mb-5">
        <h3 className="font-display text-base font-semibold">Discussion</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Every chat message that references {dealLabel}, across every channel.
        </p>
      </div>

      {backlinkQuery.isLoading ? (
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
      ) : backlinkQuery.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive">
          {apiErrorMessage(backlinkQuery.error, "Failed to load the discussion.")}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Not mentioned yet"
          description={`Reference this deal with @ in any channel type "@" then start typing its investor's name.`}
          compact
        />
      ) : (
        <div className="space-y-5">
          {entries.map((entry) => (
            <MessageItem
              key={entry.mentionId}
              message={entry.message}
              resolved={resolved}
              meta={
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Hash className="h-3 w-3" />
                  {entry.conversationName ?? "Direct message"}
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
