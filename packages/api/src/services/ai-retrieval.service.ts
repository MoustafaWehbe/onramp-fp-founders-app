import { Prisma } from "@prisma/client";
import { getAiConfig, type AiConfig } from "../config/ai";
import { prisma } from "../db/prisma";
import type { AiProvider } from "./ai-provider.service";
import { OpenAiProvider } from "./ai-provider.service";

type RetrievedChunkRow = {
  chunkId: string;
  content: string;
  tokenCount: number | null;
  pageNumber: number | null;
  sectionLabel: string | null;
  charStart: number | null;
  charEnd: number | null;
  documentId: string;
  documentVersionId: string;
  documentTitle: string;
  versionNumber: number;
  score: number;
};

export interface RetrievedDocumentChunk {
  chunkId: string;
  content: string;
  tokenCount: number;
  score: number;
  citation: {
    sourceType: "document_chunk";
    sourceId: string;
    documentChunkId: string;
    label: string;
    excerpt: string;
    metadata: {
      documentId: string;
      documentVersionId: string;
      versionNumber: number;
      sectionLabel: string | null;
      pageNumber: number | null;
      charStart: number | null;
      charEnd: number | null;
    };
  };
}

export interface RetrieveDocumentContextInput {
  startupId: string;
  query: string;
  pinnedDocumentVersionIds?: string[];
  signal?: AbortSignal;
}

function excerpt(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length <= 600 ? normalized : `${normalized.slice(0, 597)}...`;
}

/** Computed once per row (candidate and already-selected alike) rather than re-normalizing every already-selected row's content on every comparison. */
function fingerprintOf(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 400).toLowerCase();
}

type FingerprintedChunk = { row: RetrievedChunkRow; fingerprint: string };

function isNearDuplicate(candidate: RetrievedChunkRow, candidateFingerprint: string, selected: FingerprintedChunk[]): boolean {
  return selected.some(({ row: existing, fingerprint: existingFingerprint }) => {
    if (candidateFingerprint && candidateFingerprint === existingFingerprint) return true;
    if (candidate.documentVersionId !== existing.documentVersionId || candidate.charStart == null || candidate.charEnd == null || existing.charStart == null || existing.charEnd == null) return false;
    const overlap = Math.max(0, Math.min(candidate.charEnd, existing.charEnd) - Math.max(candidate.charStart, existing.charStart));
    const shortest = Math.min(candidate.charEnd - candidate.charStart, existing.charEnd - existing.charStart);
    return shortest > 0 && overlap / shortest >= 0.6;
  });
}

export class AiRetrievalService {
  constructor(private readonly provider: AiProvider = new OpenAiProvider(), private readonly config: AiConfig = getAiConfig()) {}

  async retrieveDocumentContext(input: RetrieveDocumentContextInput): Promise<RetrievedDocumentChunk[]> {
    const pinnedVersionIds = [...new Set(input.pinnedDocumentVersionIds ?? [])];
    if (pinnedVersionIds.length > 10) throw new Error("A session can pin at most 10 document versions");

    const embedding = await this.provider.embedQuery(input.query, input.signal);
    const vector = `[${embedding.join(",")}]`;
    // The HNSW index is built once, globally, across every tenant's chunks (a
    // per-tenant index isn't practical at this scale), so a startup with a
    // small corpus relative to the whole platform can lose real matches: the
    // graph search's fixed candidate pool fills up with other tenants'
    // vectors before the startup_id filter below ever sees them, and nothing
    // downstream can recover a match that was never returned. Iterative scan
    // is pgvector's fix for exactly this — a selective filter now widens the
    // graph search until it finds enough matching rows (capped by
    // hnsw.max_scan_tuples) instead of being starved by the initial pool.
    // relaxed_order is safe here because the outer ORDER BY below re-sorts by
    // the real distance value; nothing depends on the index's own row order.
    // SET LOCAL confines this to the transaction so it can't leak onto a
    // pooled connection's next, unrelated query.
    const candidates = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`;
      return tx.$queryRaw<RetrievedChunkRow[]>(Prisma.sql`
        SELECT
          ranked."chunkId", ranked.content, ranked."tokenCount",
          ranked."pageNumber", ranked."sectionLabel", ranked."charStart", ranked."charEnd",
          ranked."documentId", ranked."documentVersionId", ranked."documentTitle", ranked."versionNumber",
          1 - ranked.distance AS score
        FROM (
          SELECT
            chunk.id AS "chunkId", chunk.content, chunk.token_count AS "tokenCount",
            chunk.page_number AS "pageNumber", chunk.section_label AS "sectionLabel",
            chunk.char_start AS "charStart", chunk.char_end AS "charEnd",
            document.id AS "documentId", version.id AS "documentVersionId",
            document.title AS "documentTitle", version.version_number AS "versionNumber",
            chunk.embedding <=> ${vector}::vector AS distance
          FROM "document_chunks" AS chunk
          INNER JOIN "document_versions" AS version ON version.id = chunk.document_version_id
          INNER JOIN "documents" AS document ON document.id = version.document_id
          WHERE document.startup_id = ${input.startupId}
            AND version.processing_status = 'ready'
            AND chunk.embedding IS NOT NULL
            ${pinnedVersionIds.length ? Prisma.sql`AND version.id IN (${Prisma.join(pinnedVersionIds)})` : Prisma.empty}
          ORDER BY distance ASC
          LIMIT ${this.config.retrievalResultCount * 3}
        ) AS ranked
        WHERE 1 - ranked.distance >= ${this.config.minimumRetrievalScore}
        ORDER BY ranked.distance ASC
      `);
    });

    const selected: FingerprintedChunk[] = [];
    let usedTokens = 0;
    for (const candidate of candidates) {
      const tokenCount = candidate.tokenCount ?? Math.ceil(candidate.content.length / 4);
      const fingerprint = fingerprintOf(candidate.content);
      if (isNearDuplicate(candidate, fingerprint, selected)) continue;
      if (usedTokens + tokenCount > this.config.retrievalTokenBudget) continue;
      selected.push({ row: candidate, fingerprint });
      usedTokens += tokenCount;
      if (selected.length === this.config.retrievalResultCount) break;
    }

    return selected.map(({ row: chunk }) => ({
      chunkId: chunk.chunkId,
      content: chunk.content,
      tokenCount: chunk.tokenCount ?? Math.ceil(chunk.content.length / 4),
      score: Number(chunk.score),
      citation: {
        sourceType: "document_chunk",
        sourceId: chunk.chunkId,
        documentChunkId: chunk.chunkId,
        label: `${chunk.documentTitle} · v${chunk.versionNumber}${chunk.sectionLabel ? ` · ${chunk.sectionLabel}` : ""}`,
        excerpt: excerpt(chunk.content),
        metadata: {
          documentId: chunk.documentId,
          documentVersionId: chunk.documentVersionId,
          versionNumber: chunk.versionNumber,
          sectionLabel: chunk.sectionLabel,
          // The UI may show this only when parsing populated it never infer one.
          pageNumber: chunk.pageNumber,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
        },
      },
    }));
  }
}

export const aiRetrievalService = new AiRetrievalService();
