import { encode } from "gpt-tokenizer";

const TARGET_TOKENS = 650;
const OVERLAP_RATIO = 0.15;

const NAMED_HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/**
 * LlamaParse's markdown can carry literal HTML entities (e.g. "&#x26;" for "&")
 * from the source document's XML. Decoding once here — before any char-offset
 * math — keeps section labels, excerpts, and the text sent to the model clean;
 * doing it after chunking would desync charStart/charEnd against the stored text.
 */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const codePoint = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_HTML_ENTITIES[entity] ?? match;
  });
}

export type TextChunk = {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  sectionLabel: string | null;
  charStart: number;
  charEnd: number;
};

function splitMarkdownSections(markdown: string): Array<{ label: string | null; body: string; start: number }> {
  const lines = markdown.split(/\r?\n/);
  const sections: Array<{ label: string | null; body: string; start: number }> = [];
  let currentLabel: string | null = null;
  let currentLines: string[] = [];
  let currentStart = 0;
  let offset = 0;

  const flush = () => {
    const body = currentLines.join("\n").trim();
    if (body) sections.push({ label: currentLabel, body, start: currentStart });
    currentLines = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      currentLabel = heading[2].trim();
      currentStart = offset;
      currentLines = [line];
    } else {
      if (currentLines.length === 0) currentStart = offset;
      currentLines.push(line);
    }
    offset += line.length + 1;
  }
  flush();
  return sections.length > 0 ? sections : [{ label: null, body: markdown.trim(), start: 0 }];
}

function windowByTokens(text: string, baseOffset: number, sectionLabel: string | null, startIndex: number) {
  const tokens = encode(text);
  const chunks: TextChunk[] = [];
  if (tokens.length === 0) return chunks;

  const overlap = Math.max(1, Math.floor(TARGET_TOKENS * OVERLAP_RATIO));
  let start = 0;
  let index = startIndex;

  while (start < tokens.length) {
    const end = Math.min(tokens.length, start + TARGET_TOKENS);
    const slice = tokens.slice(start, end);
    // Approximate char offsets via proportional mapping for citation UX.
    const charStart = baseOffset + Math.floor((start / tokens.length) * text.length);
    const charEnd = baseOffset + Math.floor((end / tokens.length) * text.length);
    const content = text.slice(
      Math.max(0, charStart - baseOffset),
      Math.min(text.length, charEnd - baseOffset),
    ) || text;

    chunks.push({
      chunkIndex: index,
      content: content.trim() || text.slice(0, 500),
      tokenCount: slice.length,
      sectionLabel,
      charStart,
      charEnd: Math.max(charStart + 1, charEnd),
    });
    index += 1;
    if (end >= tokens.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

/** Split LlamaParse (or plain) markdown into overlapping token windows. */
export function chunkMarkdown(markdown: string): TextChunk[] {
  const sections = splitMarkdownSections(decodeHtmlEntities(markdown));
  const out: TextChunk[] = [];
  for (const section of sections) {
    const next = windowByTokens(section.body, section.start, section.label, out.length);
    out.push(...next);
  }
  return out;
}
