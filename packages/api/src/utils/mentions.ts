/**
 * A chat message body is stored as plain text carrying inline reference
 * tokens `@[Sequoia Seed](deal:3f9c...)` rather than pre-rendered HTML.
 * That keeps the column searchable (full-text search, embeddings later) and
 * means a renamed investor doesn't leave every historical message showing a
 * stale name: the label is a display hint, the id after the colon is what
 * actually gets resolved at read time.
 *
 * The composer's MentionPicker is the only thing that writes these tokens —
 * see packages/web/src/pages/dashboard/Chat/MentionPicker.tsx. Anything a
 * human free-types (an email address, a stray "@" typo) simply doesn't match
 * the pattern and stays as plain text.
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

export function isMentionTargetType(value: string): value is MentionTargetType {
  return (MENTION_TARGET_TYPES as readonly string[]).includes(value);
}

const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const MENTION_PATTERN = new RegExp(
  `@\\[([^\\]\\n]{1,120})\\]\\((${MENTION_TARGET_TYPES.join("|")}):(${UUID_PATTERN})\\)`,
  "g",
);

export interface ParsedMention {
  type: MentionTargetType;
  id: string;
  label: string;
}

/**
 * Extracts every reference token from a message body, deduplicated by
 * (type, id) mentioning the same deal twice in one message still produces
 * one MessageMention row, since the backlink only needs to know "this
 * message references that deal," not how many times.
 */
export function parseMentions(body: string): ParsedMention[] {
  const seen = new Set<string>();
  const mentions: ParsedMention[] = [];

  for (const match of body.matchAll(MENTION_PATTERN)) {
    const [, label, type, id] = match;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({ type: type as MentionTargetType, id, label });
  }

  return mentions;
}

/** Renders `@[Label](type:id)` down to `@Label` for notification previews, not the message view itself. */
export function toPlainExcerpt(body: string, maxLength = 140): string {
  const plain = body.replace(MENTION_PATTERN, (_match, label: string) => `@${label}`).trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain;
}
