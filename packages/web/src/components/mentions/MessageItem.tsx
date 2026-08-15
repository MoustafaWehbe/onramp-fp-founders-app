import { FileText, MessagesSquare } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { cn, getInitials } from "../../lib/utils";
import { collectMentionRefs } from "../../lib/mentions";
import type { Message, ResolvedMention } from "../../lib/chat-api";
import { MessageBody } from "./MessageBody";
import { EntityUnfurl, isUnfurlable } from "./EntityUnfurl";
import { MessageHoverActions } from "./MessageHoverActions";
import { ReactionRow } from "./ReactionRow";

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

type MessageItemProps = {
  message: Message;
  resolved: Map<string, ResolvedMention>;
  /** True when the previous message in the list is from the same sender, close enough in time to read as one run collapses the avatar/name into a hover-only timestamp, Slack-style. */
  grouped?: boolean;
  /** Extra content to the right of the timestamp DiscussionTab uses this for the source channel. */
  meta?: React.ReactNode;
  /** Present only where reacting makes sense (the live thread) DiscussionTab omits it and reactions render read-only. */
  onReact?: (emoji: string) => void;
  /** Present only on a top-level message in a live channel opens the ThreadDialog. */
  onOpenThread?: () => void;
  /** Present when the caller may remove this message (their own, or chat:manage). */
  onDelete?: () => void;
};

/** One chat message avatar, name, time, body with reference chips, attachments, reactions, and any unfurl cards. Shared by MessageThread, ThreadDialog and DiscussionTab so a message renders identically everywhere. */
export function MessageItem({ message, resolved, grouped, meta, onReact, onOpenThread, onDelete }: MessageItemProps) {
  const refs = collectMentionRefs(message.body).filter((ref) => isUnfurlable(ref.type));
  const hasReplies = message.replyCount > 0;
  const isDeleted = message.deletedAt !== null;

  return (
    <div
      className={cn(
        "group relative -mx-2 flex items-start gap-3 rounded-md px-2 py-1 transition-colors hover:bg-surface/40",
        grouped ? "mt-px" : "mt-3 first:mt-0",
      )}
    >
      {grouped ? (
        <div className="grid h-8 w-8 shrink-0 place-items-center">
          <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground group-hover:inline">
            {formatTime(message.createdAt)}
          </span>
        </div>
      ) : (
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={message.sender?.avatarUrl ?? undefined} alt="" />
          <AvatarFallback className="text-xs font-medium">
            {getInitials(senderName(message.sender))}
          </AvatarFallback>
        </Avatar>
      )}
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-foreground">{senderName(message.sender)}</span>
            <span className="text-[11px] text-muted-foreground">{formatTime(message.createdAt)}</span>
            {meta}
          </div>
        )}
        {isDeleted ? (
          <p className="text-sm italic text-muted-foreground">This message was deleted.</p>
        ) : (
          <>
            <MessageBody body={message.body} />

            {message.attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {message.attachments.map((attachment) => (
                  <span
                    key={attachment.documentId}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-surface/40 px-2.5 py-1 text-xs"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="max-w-[14rem] truncate font-medium">{attachment.title}</span>
                  </span>
                ))}
              </div>
            )}

            {refs.map((ref) => {
              const item = resolved.get(`${ref.type}:${ref.id}`);
              return item ? <EntityUnfurl key={`${ref.type}:${ref.id}`} mention={item} /> : null;
            })}

            <ReactionRow reactions={message.reactions} onToggle={onReact} />
          </>
        )}

        {hasReplies && onOpenThread && (
          <button
            type="button"
            onClick={onOpenThread}
            className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <MessagesSquare className="h-3 w-3" />
            {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
          </button>
        )}
      </div>

      {!isDeleted && (
        <MessageHoverActions
          onReact={onReact}
          onOpenThread={!hasReplies ? onOpenThread : undefined}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}
