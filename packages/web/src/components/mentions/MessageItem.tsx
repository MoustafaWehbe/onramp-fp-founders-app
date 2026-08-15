import { FileText, MessagesSquare } from "lucide-react";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { getInitials } from "../../lib/utils";
import { collectMentionRefs } from "../../lib/mentions";
import type { Message, ResolvedMention } from "../../lib/chat-api";
import { MessageBody } from "./MessageBody";
import { EntityUnfurl, isUnfurlable } from "./EntityUnfurl";
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
  /** Extra content to the right of the timestamp — DiscussionTab uses this for the source channel. */
  meta?: React.ReactNode;
  /** Present only where reacting makes sense (the live thread) — DiscussionTab omits it and reactions render read-only. */
  onReact?: (emoji: string) => void;
  /** Present only on a top-level message in a live channel — opens the ThreadDialog. */
  onOpenThread?: () => void;
};

/** One chat message — avatar, name, time, body with reference chips, attachments, reactions, and any unfurl cards. Shared by MessageThread, ThreadDialog and DiscussionTab so a message renders identically everywhere. */
export function MessageItem({ message, resolved, meta, onReact, onOpenThread }: MessageItemProps) {
  const refs = collectMentionRefs(message.body).filter((ref) => isUnfurlable(ref.type));

  return (
    <div className="flex items-start gap-3">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-xs font-medium">
          {getInitials(senderName(message.sender))}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">{senderName(message.sender)}</span>
          <span className="text-[11px] text-muted-foreground">{formatTime(message.createdAt)}</span>
          {meta}
        </div>
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

        {onOpenThread && (
          <button
            type="button"
            onClick={onOpenThread}
            className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <MessagesSquare className="h-3 w-3" />
            {message.replyCount > 0
              ? `${message.replyCount} ${message.replyCount === 1 ? "reply" : "replies"}`
              : "Reply in thread"}
          </button>
        )}
      </div>
    </div>
  );
}
