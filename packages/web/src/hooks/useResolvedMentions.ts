import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveMentions, type Message, type ResolvedMention } from "../lib/chat-api";
import { collectMentionRefs } from "../lib/mentions";
import { qk } from "../lib/query-keys";

/**
 * Batch-resolves every distinct reference across a list of messages in one
 * request per API-sized batch, rather than one /chat/resolve call per chip.
 * Loading older history can exceed the API's 50-item validation ceiling, so
 * larger sets are split deterministically. Returns a lookup keyed by "type:id"; a chip
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
    queryFn: async () => {
      const batches: typeof refs[] = [];
      for (let index = 0; index < refs.length; index += 50) {
        batches.push(refs.slice(index, index + 50));
      }
      return (await Promise.all(batches.map((batch) => resolveMentions(startupId, batch)))).flat();
    },
    enabled: refs.length > 0,
  });

  return useMemo(() => {
    const map = new Map<string, ResolvedMention>();
    for (const item of query.data ?? []) map.set(`${item.type}:${item.id}`, item);
    return map;
  }, [query.data]);
}
