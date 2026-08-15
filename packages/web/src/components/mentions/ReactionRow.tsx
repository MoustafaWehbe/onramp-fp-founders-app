import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { cn } from "../../lib/utils";
import { REACTION_EMOJIS } from "../../lib/mentions";
import type { MessageReactionSummary } from "../../lib/chat-api";

type ReactionRowProps = {
  reactions: MessageReactionSummary[];
  /** Omitted in read-only contexts (the Discussion tab) — counts still show, but nothing is clickable. */
  onToggle?: (emoji: string) => void;
};

function pillClass(reactedByMe: boolean, interactive: boolean): string {
  return cn(
    "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
    reactedByMe
      ? "border-primary/40 bg-primary/[0.08] text-primary"
      : "border-border/70 bg-surface text-muted-foreground",
    interactive && !reactedByMe && "hover:border-border",
  );
}

export function ReactionRow({ reactions, onToggle }: ReactionRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  if (reactions.length === 0 && !onToggle) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {reactions.map((r) =>
        onToggle ? (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onToggle(r.emoji)}
            className={pillClass(r.reactedByMe, true)}
          >
            <span>{r.emoji}</span>
            <span className="font-mono tabular-nums">{r.count}</span>
          </button>
        ) : (
          <div key={r.emoji} className={pillClass(r.reactedByMe, false)}>
            <span>{r.emoji}</span>
            <span className="font-mono tabular-nums">{r.count}</span>
          </div>
        ),
      )}

      {onToggle && (
        <div className="relative">
          <button
            type="button"
            aria-label="Add reaction"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </button>
          {pickerOpen && (
            <div className="absolute bottom-full left-0 z-10 mb-1 flex gap-0.5 rounded-lg border border-border/70 bg-popover p-1 shadow-lg">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onToggle(emoji);
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
    </div>
  );
}
