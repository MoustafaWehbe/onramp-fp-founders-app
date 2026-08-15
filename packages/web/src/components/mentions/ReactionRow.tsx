import { cn } from "../../lib/utils";
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

/** Existing reactions only — adding a new one lives in the hover-revealed MessageHoverActions instead, since an empty message shouldn't carry a permanent "add reaction" row. */
export function ReactionRow({ reactions, onToggle }: ReactionRowProps) {
  if (reactions.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
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
    </div>
  );
}
