import { cn } from "../../../lib/utils";
import { MENTION_TYPE_LABELS } from "../../../lib/mentions";
import { MENTION_TYPE_ICONS } from "../../../components/mentions/mention-icons";
import type { MentionableItem } from "../../../lib/chat-api";

type MentionPickerProps = {
  items: MentionableItem[];
  isLoading: boolean;
  query: string;
  highlightedIndex: number;
  onHover: (index: number) => void;
  onSelect: (item: MentionableItem) => void;
};

/**
 * Docked above the composer rather than tracking the caret the caret-
 * coordinate mirroring trick a contenteditable picker would need is a lot of
 * fragile DOM measurement for a cosmetic gain. See Composer.tsx for how
 * selection splices the token into the textarea.
 */
export function MentionPicker({
  items,
  isLoading,
  query,
  highlightedIndex,
  onHover,
  onSelect,
}: MentionPickerProps) {
  const showEmpty = !isLoading && items.length === 0 && query.trim().length > 0;

  return (
    <div className="scrollbar-slim max-h-64 overflow-y-auto rounded-lg border border-border/70 bg-popover p-1 shadow-lg">
      {isLoading && (
        <div className="px-3 py-2.5 text-xs text-muted-foreground">Searching…</div>
      )}

      {showEmpty && (
        <div className="px-3 py-2.5 text-xs text-muted-foreground">
          Nothing matches "{query}"
        </div>
      )}

      {!isLoading && items.length === 0 && query.trim().length === 0 && (
        <div className="px-3 py-2.5 text-xs text-muted-foreground">
          Keep typing to search people, investors, deals, tasks, rounds and documents.
        </div>
      )}

      {items.map((item, index) => {
        const Icon = MENTION_TYPE_ICONS[item.type];
        const active = index === highlightedIndex;
        return (
          <button
            key={`${item.type}:${item.id}`}
            type="button"
            // Mousedown, not click: firing before the textarea's blur keeps
            // focus (and the caret position) in the composer.
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
            onMouseEnter={() => onHover(index)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
              active ? "bg-sidebar-accent text-foreground" : "text-foreground/90 hover:bg-sidebar-accent",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {item.sublabel ?? MENTION_TYPE_LABELS[item.type]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
