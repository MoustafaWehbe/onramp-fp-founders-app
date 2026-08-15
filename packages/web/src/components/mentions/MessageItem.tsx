import { Avatar, AvatarFallback } from "../ui/avatar";
import { getInitials } from "../../lib/utils";
import { collectMentionRefs } from "../../lib/mentions";
import type { Message, ResolvedMention } from "../../lib/chat-api";
import { MessageBody } from "./MessageBody";
import { EntityUnfurl, isUnfurlable } from "./EntityUnfurl";

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
};

/** One chat message — avatar, name, time, body with reference chips, and any unfurl cards. Shared by MessageThread and DiscussionTab so a message renders identically in both places. */
export function MessageItem({ message, resolved, meta }: MessageItemProps) {
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
        {refs.map((ref) => {
          const item = resolved.get(`${ref.type}:${ref.id}`);
          return item ? <EntityUnfurl key={`${ref.type}:${ref.id}`} mention={item} /> : null;
        })}
      </div>
    </div>
  );
}
