import { Archive, BellOff, Hash, Plus, User } from "lucide-react";
import { cn, getInitials } from "../../../lib/utils";
import type { Conversation } from "../../../lib/chat-api";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { Skeleton } from "../../../components/ui/skeleton";
import { EmptyState } from "../../../components/shared/EmptyState";
import { Button } from "../../../components/ui/button";

/** Short relative label for a channel's last activity "2h", "3d", "just now". */
function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(iso),
  );
}

function conversationLabel(conversation: Conversation): string {
  if (conversation.type === "channel") return conversation.name ?? "";
  const c = conversation.counterpart;
  return c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Teammate" : "Direct message";
}

type ConversationRowProps = {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
};

function ConversationRow({ conversation, active, onSelect }: ConversationRowProps) {
  const unread = conversation.unreadCount > 0;
  const label = conversationLabel(conversation);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors",
          active
            ? "bg-sidebar-accent font-medium text-primary"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          conversation.archivedAt && "opacity-75",
        )}
      >
        {conversation.type === "channel" ? (
          <div
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-md",
              active ? "bg-primary/15 text-primary" : "bg-surface text-muted-foreground",
            )}
          >
            <Hash className="h-3.5 w-3.5" />
          </div>
        ) : (
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={conversation.counterpart?.avatarUrl ?? undefined} alt="" className="object-cover" />
            <AvatarFallback className="text-[10px] font-medium">
              {conversation.counterpart ? getInitials(label) : <User className="h-3 w-3" />}
            </AvatarFallback>
          </Avatar>
        )}
        <span className={cn("min-w-0 flex-1 truncate", unread && !active && "font-semibold text-foreground")}>
          {label}
        </span>
        {conversation.notifyLevel === "none" && (
          <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Muted" />
        )}
        {unread && (
          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[10px] font-semibold tabular-nums text-primary-foreground shadow-xs">
            {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
          </span>
        )}
        {!unread && conversation.lastMessageAt && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatRelative(conversation.lastMessageAt)}
          </span>
        )}
      </button>
    </li>
  );
}

type ConversationListProps = {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  canCreate: boolean;
  onCreateChannel: () => void;
  onCreateDm: () => void;
  className?: string;
};

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  isLoading,
  canCreate,
  onCreateChannel,
  onCreateDm,
  className,
}: ConversationListProps) {
  const channels = conversations.filter((c) => c.type === "channel" && !c.archivedAt);
  const dms = conversations.filter((c) => c.type === "dm" && !c.archivedAt);
  const archived = conversations.filter((c) => c.archivedAt);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Channels
        </span>
        {canCreate && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label="New channel"
            onClick={onCreateChannel}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-2" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-md" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={Hash}
            title="No channels yet"
            description={
              canCreate
                ? "Start one so the team has a place to talk."
                : "Nobody has started a channel here yet."
            }
            action={
              canCreate ? (
                <Button type="button" size="sm" onClick={onCreateChannel}>
                  <Plus className="h-3.5 w-3.5" />
                  New channel
                </Button>
              ) : undefined
            }
            compact
          />
        ) : (
          <>
            {channels.length > 0 && (
              <ul className="space-y-0.5 p-2">
                {channels.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === selectedId}
                    onSelect={() => onSelect(conversation.id)}
                  />
                ))}
              </ul>
            )}

            {canCreate && (
              <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
                <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Direct messages
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label="New direct message"
                  onClick={onCreateDm}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {dms.length > 0 && (
              <ul className="space-y-0.5 p-2">
                {dms.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === selectedId}
                    onSelect={() => onSelect(conversation.id)}
                  />
                ))}
              </ul>
            )}

            {archived.length > 0 && (
              <>
                <div className="flex items-center gap-2 border-t border-border/60 px-4 py-3">
                  <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                    Archived
                  </span>
                  <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {archived.length}
                  </span>
                </div>
                <ul className="space-y-0.5 px-2 pb-2">
                  {archived.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      active={conversation.id === selectedId}
                      onSelect={() => onSelect(conversation.id)}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
