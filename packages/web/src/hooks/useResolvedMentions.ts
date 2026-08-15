import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveMentions, type Message, type ResolvedMention } from "../lib/chat-api";
import { collectMentionRefs } from "../lib/mentions";
import { qk } from "../lib/query-keys";

/**
 * Batch-resolves every distinct reference across a list of messages in one
 * request, rather than one /chat/resolve call per chip — a 30-message
 * screen stays at one request. Returns a lookup keyed by "type:id"; a chip
 * whose key is missing (unresolved, permission-filtered, or deleted) simply
 * renders without its unfurl card.
 */
export function useResolvedMentions(startupId: string, messages: Message[]) {
  const refs = useMemo(() => {
    const seen = new Set<string>();
    const all: { type: ResolvedMention["type"]; id: string }[] = [];
    for (const message of messages) {
      for (const ref of collectMentionRefs(message.body)) {
        const key = `${ref.type}:${ref.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(ref);
      }
    }
    return all;
  }, [messages]);

  const digest = useMemo(
    () =>
      refs
        .map((r) => `${r.type}:${r.id}`)
        .sort()
        .join(","),
    [refs],
  );

  const query = useQuery({
    queryKey: qk.resolveMentions(startupId, digest),
    queryFn: () => resolveMentions(startupId, refs),
    enabled: refs.length > 0,
  });

  return useMemo(() => {
    const map = new Map<string, ResolvedMention>();
    for (const item of query.data ?? []) map.set(`${item.type}:${item.id}`, item);
    return map;
  }, [query.data]);
}
