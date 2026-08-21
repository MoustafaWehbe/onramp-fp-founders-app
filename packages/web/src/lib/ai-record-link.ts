const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Builds only app-owned routes from a fixed entity allowlist. */
export function aiRecordLink(sourceType: string, sourceId: string, metadata: unknown): string | null {
  if (!UUID.test(sourceId)) return null;
  if (sourceType === "round") return `/fundraising?round=${encodeURIComponent(sourceId)}`;
  if (sourceType === "investor") return `/investors?investor=${encodeURIComponent(sourceId)}`;
  if (sourceType === "pipeline") return `/pipeline?deal=${encodeURIComponent(sourceId)}`;
  if (sourceType === "task") return `/pipeline?task=${encodeURIComponent(sourceId)}`;
  if (sourceType !== "document_chunk" || !metadata || typeof metadata !== "object") return null;
  const documentId = (metadata as { documentId?: unknown }).documentId;
  return typeof documentId === "string" && UUID.test(documentId) ? `/documents?documentId=${encodeURIComponent(documentId)}` : null;
}
