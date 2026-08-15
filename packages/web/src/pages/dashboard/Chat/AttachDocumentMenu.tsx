import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Input } from "../../../components/ui/input";
import { qk } from "../../../lib/query-keys";
import { searchMentionables, type MentionableItem } from "../../../lib/chat-api";

type AttachDocumentMenuProps = {
  startupId: string;
  /** Already-attached ids, so a picked document doesn't offer itself twice. */
  excludeIds: string[];
  onSelect: (item: MentionableItem) => void;
};

/** A small standalone search dropdown for the composer's attach button — document search only, no message-body mention token involved. */
export function AttachDocumentMenu({ startupId, excludeIds, onSelect }: AttachDocumentMenuProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  const docsQuery = useQuery({
    queryKey: qk.mentionables(startupId, debounced, ["document"]),
    queryFn: () => searchMentionables(startupId, { q: debounced, types: ["document"] }),
    enabled: debounced.trim().length > 0,
  });

  const items = (docsQuery.data ?? []).filter((item) => !excludeIds.includes(item.id));

  return (
    <div className="w-72 rounded-lg border border-border/70 bg-popover p-2 shadow-lg">
      <Input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search documents…"
        className="h-8 text-sm"
      />
      <div className="scrollbar-slim mt-1.5 max-h-56 overflow-y-auto">
        {docsQuery.isFetching && (
          <div className="px-2 py-2 text-xs text-muted-foreground">Searching…</div>
        )}
        {!docsQuery.isFetching && debounced.trim().length > 0 && items.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">Nothing matches "{debounced}"</div>
        )}
        {!docsQuery.isFetching && debounced.trim().length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">Type to search the document vault.</div>
        )}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground/90 transition-colors hover:bg-sidebar-accent"
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.sublabel && (
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {item.sublabel}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
