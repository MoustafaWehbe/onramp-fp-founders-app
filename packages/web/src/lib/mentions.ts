/**
 * Client-side mirror of packages/api/src/utils/mentions.ts same token
 * format, same regex. A message body is plain text carrying inline
 * `@[Label](type:id)` tokens; this file is what turns those back into
 * renderable segments, and what the composer writes when a MentionPicker
 * selection is inserted.
 */

export const MENTION_TARGET_TYPES = [
  "member",
  "investor",
  "deal",
  "task",
  "round",
  "document",
] as const;

export type MentionTargetType = (typeof MENTION_TARGET_TYPES)[number];

export const MENTION_TYPE_LABELS: Record<MentionTargetType, string> = {
  member: "People",
  investor: "Investors",
  deal: "Deals",
  task: "Tasks",
  round: "Rounds",
  document: "Documents",
};

/** The fixed reaction palette the API accepts any short string, but the picker only ever offers these. */
export const REACTION_EMOJIS = ["👍", "❤️", "🎉", "👀", "✅", "🚀"] as const;

const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const MENTION_PATTERN = new RegExp(
  `@\\[([^\\]\\n]{1,120})\\]\\((${MENTION_TARGET_TYPES.join("|")}):(${UUID_PATTERN})\\)`,
  "g",
);

/** Builds the literal text a MentionPicker selection inserts into the composer. */
export function mentionToken(type: MentionTargetType, id: string, label: string): string {
  // A label can't contain "]" the picker's own labels never do, but guard
  // against a display name that does so the token still parses back out.
  return `@[${label.replace(/\]/g, "")}](${type}:${id})`;
}

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; type: MentionTargetType; id: string; label: string };

/** Splits a message body into plain-text runs and reference tokens, in order. */
export function splitMessageBody(body: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  for (const match of body.matchAll(MENTION_PATTERN)) {
    const [full, label, type, id] = match;
    const start = match.index ?? 0;
    if (start > lastIndex) segments.push({ kind: "text", text: body.slice(lastIndex, start) });
    segments.push({ kind: "mention", type: type as MentionTargetType, id, label });
    lastIndex = start + full.length;
  }

  if (lastIndex < body.length) segments.push({ kind: "text", text: body.slice(lastIndex) });
  return segments;
}

/** Every distinct (type, id) referenced in a body what a batch /chat/resolve call needs. */
export function collectMentionRefs(body: string): { type: MentionTargetType; id: string }[] {
  const seen = new Set<string>();
  const refs: { type: MentionTargetType; id: string }[] = [];
  for (const segment of splitMessageBody(body)) {
    if (segment.kind !== "mention") continue;
    const key = `${segment.type}:${segment.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ type: segment.type, id: segment.id });
  }
  return refs;
}
