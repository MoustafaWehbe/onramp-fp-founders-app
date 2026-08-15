import { Hash, Plus } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { Conversation } from "../../../lib/chat-api";
import { Skeleton } from "../../../components/ui/skeleton";
import { EmptyState } from "../../../components/shared/EmptyState";
import { Button } from "../../../components/ui/button";

/** Short relative label for a channel's last activity — "2h", "3d", "just now". */
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

type ConversationListProps = {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  canCreate: boolean;
  onCreate: () => void;
  className?: string;
};

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  isLoading,
  canCreate,
  onCreate,
  className,
}: ConversationListProps) {
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
            onClick={onCreate}
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
                <Button type="button" size="sm" onClick={onCreate}>
                  <Plus className="h-3.5 w-3.5" />
                  New channel
                </Button>
              ) : undefined
            }
            compact
          />
        ) : (
          <ul className="space-y-0.5 p-2">
            {conversations.map((conversation) => {
              const active = conversation.id === selectedId;
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent font-medium text-primary"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                    )}
                  >
                    <Hash
                      className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")}
                    />
                    <span className="min-w-0 flex-1 truncate">{conversation.name}</span>
                    {conversation.lastMessageAt && (
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {formatRelative(conversation.lastMessageAt)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
