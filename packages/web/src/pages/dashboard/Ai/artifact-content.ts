export function splitArtifactBackedContent(content: string): { intro: string; followup: string } {
  const normalized = content.trim();
  if (!normalized) return { intro: "", followup: "" };
  const boundary = normalized.search(/\n\s*\n/);
  if (boundary === -1) return { intro: normalized, followup: "" };
  return {
    intro: normalized.slice(0, boundary).trim(),
    followup: normalized.slice(boundary).trim(),
  };
}
