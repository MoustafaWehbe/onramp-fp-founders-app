type ArtifactLike = { type: string; data: unknown };

const INTRO_BY_TYPE: Array<[string, string]> = [
  ["daily_briefing.v1", "Here’s today’s briefing."],
  ["meeting_brief.v1", "Here’s your meeting brief."],
  ["focus_list.v1", "Here are the investors to prioritize."],
  ["pipeline_board.v1", "Here’s the current pipeline."],
  ["forecast.v1", "Here’s the round forecast."],
  ["task_list.v1", "Here are the relevant tasks."],
  ["investor_brief.v1", "Here’s the investor context."],
  ["action_proposal.v1", "I’ve prepared this for your review."],
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function collectArtifactValues(value: unknown, values: Set<string>): void {
  if (typeof value === "string") {
    const normalized = normalize(value);
    // Short categorical words such as "high" or "seed" can legitimately occur
    // in useful recommendations, so they are not enough to mark prose repeated.
    if (normalized.length >= 6) values.add(normalized);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectArtifactValues(item, values));
    return;
  }
  if (value && typeof value === "object") Object.values(value).forEach((item) => collectArtifactValues(item, values));
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2));
}

function substantiallyRepeats(left: string, right: string): boolean {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return false;
  let shared = 0;
  a.forEach((token) => { if (b.has(token)) shared += 1; });
  return shared / Math.min(a.size, b.size) >= 0.65;
}

export function splitArtifactBackedContent(content: string, artifacts: ArtifactLike[] = []): { intro: string; followup: string } {
  const normalized = content.trim();
  const artifactTypes = new Set(artifacts.map((artifact) => artifact.type));
  const intro = artifactTypes.has("investor_brief.v1") && artifactTypes.has("task_list.v1")
    ? "Here’s the priority investor and related work."
    : INTRO_BY_TYPE.find(([type]) => artifactTypes.has(type))?.[1] ?? "Here’s what I found.";
  if (!normalized) return { intro, followup: "" };
  // These cards intentionally contain the complete draft/brief. Re-rendering
  // any generated prose around them would repeat their primary content.
  if (artifactTypes.has("action_proposal.v1") || artifactTypes.has("meeting_brief.v1")) return { intro, followup: "" };

  const artifactValues = new Set<string>();
  artifacts.forEach((artifact) => collectArtifactValues(artifact.data, artifactValues));
  const kept: string[] = [];
  const blocks = normalized.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  for (const block of blocks) {
    // Cards own headings and lists. Text below them is reserved for insight or a
    // next step that the structured presentation does not already communicate.
    if (/^(#{1,6}\s|[-*]\s|\d+\.\s)/m.test(block)) continue;
    const blockValue = normalize(block);
    const matchedValues = [...artifactValues].filter((value) => blockValue.includes(value));
    if (matchedValues.length >= 2 || (blocks.length === 1 && matchedValues.length >= 1)) continue;
    if (kept.some((existing) => substantiallyRepeats(existing, block))) continue;
    kept.push(block);
  }

  return { intro, followup: kept.slice(0, 2).join("\n\n") };
}
