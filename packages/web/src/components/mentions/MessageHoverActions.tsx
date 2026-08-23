import { useState } from "react";
import { MessagesSquare, SmilePlus, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { REACTION_EMOJIS } from "../../lib/mentions";

type MessageHoverActionsProps = {
  onReact?: (emoji: string) => void;
  onOpenThread?: () => void;
  /** Present only on the caller's own message — no moderator override to delete someone else's. */
  onDelete?: () => void;
};

/**
 * The react/reply/delete affordances float over the message's top-right
 * corner and stay invisible until the row is hovered or focused the message
 * itself (and any reactions/replies it already has) is the content; these are
 * just entry points for adding more, so they shouldn't compete for attention
 * at rest. Requires a `group` class on the message row this is nested in.
 */
export function MessageHoverActions({ onReact, onOpenThread, onDelete }: MessageHoverActionsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  if (!onReact && !onOpenThread && !onDelete) return null;

  return (
    <div
      className={cn(
        "absolute -top-3.5 right-2 z-1 flex items-center gap-0.5 rounded-md border border-border/70 bg-popover p-0.5 opacity-0 shadow-xs transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        pickerOpen && "opacity-100",
      )}
    >
      {onReact && (
        <div className="relative">
          <button
            type="button"
            aria-label="Add reaction"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </button>
          {pickerOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 flex gap-0.5 rounded-lg border border-border/70 bg-popover p-1 shadow-lg">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onReact(emoji);
                    setPickerOpen(false);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-base hover:bg-sidebar-accent"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {onOpenThread && (
        <button
          type="button"
          aria-label="Reply in thread"
          onClick={onOpenThread}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <MessagesSquare className="h-3.5 w-3.5" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          aria-label="Delete message"
          onClick={onDelete}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
